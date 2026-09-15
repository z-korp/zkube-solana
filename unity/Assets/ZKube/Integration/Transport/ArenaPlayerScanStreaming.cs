using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration.Transport
{
    public sealed partial class SolanaRpcTransport
    {
        // Same supported discovery envelope as services/src/anchorIdlAdapter.ts.
        // This is a fail-closed systems bound, never a truncation or entry cap.
        public const int MaximumArenaPlayerAccounts = 100000;

        // Accumulate locally: no result is accepted until this method returns
        // and the caller verifies its bracketing accounts. Decode one bounded
        // account at a time, never a 100k-object JSON DOM. The existing HTTP
        // interface still buffers a bounded raw string; profile that separately.
        public async Task<ulong> ReadArenaPlayers(AccountBindings bindings, uint day,
            ulong minContextSlot, Action<AccountEnvelope, JObject> accumulate, CancellationToken cancellation = default)
        {
            if (bindings == null || bindings.ProgramId != program) throw new ArgumentException("Scan program differs from account validator");
            if (accumulate == null) throw new ArgumentNullException(nameof(accumulate));
            int bytes = bindings.FixedAccountBytes("ArenaPlayer"); AccountBound(bytes);
            var config = AccountConfig(minContextSlot);
            config["withContext"] = true; config["filters"] = bindings.ArenaPlayerScanFilters(day);
            await VerifyBase(cancellation).ConfigureAwait(false);
            long id = Interlocked.Increment(ref requestId);
            var request = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = "getProgramAccounts", ["params"] = new JArray(program, config) };
            int bound = checked(MaximumArenaPlayerAccounts * (bytes * 2 + 512) + 4096);
            string json = await http.Post(Base.Address, request.ToString(Formatting.None), bound, cancellation).ConfigureAwait(false);
            if (json == null || Encoding.UTF8.GetByteCount(json) > bound) throw new FormatException("ArenaPlayer response exceeds its byte bound");
            // Bound raw subtrees before JsonTextReader can allocate token text
            // or JToken can materialize an object. HTTP still buffers json.
            new ScanJsonBounds(json, cancellation).Validate();
            using var reader = new JsonTextReader(new StringReader(json)) { MaxDepth = 32, DateParseHandling = DateParseHandling.None };
            var settings = new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error };
            var rootFields = new HashSet<string>(StringComparer.Ordinal);
            bool version = false, identity = false; ulong? slot = null; JObject error = null;
            RequireScanRead(reader, JsonToken.StartObject);
            while (true)
            {
                if (!reader.Read()) throw new FormatException("Truncated RPC response object");
                if (reader.TokenType == JsonToken.EndObject) break;
                string field = ScanProperty(reader, rootFields);
                if (!reader.Read()) throw new FormatException("Truncated RPC response");
                if (field == "jsonrpc") version = String(JToken.ReadFrom(reader, settings)) == "2.0";
                else if (field == "id") identity = Unsigned(JToken.ReadFrom(reader, settings)) == (ulong)id;
                else if (field == "error") error = Object(JToken.ReadFrom(reader, settings));
                else if (field == "result")
                {
                    if (reader.TokenType != JsonToken.StartObject) throw new FormatException("ArenaPlayer scan requires a context-bearing result");
                    var resultFields = new HashSet<string>(StringComparer.Ordinal); bool values = false;
                    var seen = new HashSet<string>(StringComparer.Ordinal); int count = 0;
                    while (true)
                    {
                        if (!reader.Read()) throw new FormatException("Truncated scan result object");
                        if (reader.TokenType == JsonToken.EndObject) break;
                        string resultField = ScanProperty(reader, resultFields);
                        if (!reader.Read()) throw new FormatException("Truncated scan result");
                        if (resultField == "context") slot = Unsigned(Object(JToken.ReadFrom(reader, settings))["slot"]);
                        else if (resultField == "value")
                        {
                            if (reader.TokenType != JsonToken.StartArray) throw new FormatException("ArenaPlayer scan value must be an array");
                            values = true;
                            while (true)
                            {
                                if (!reader.Read()) throw new FormatException("Truncated ArenaPlayer array");
                                if (reader.TokenType == JsonToken.EndArray) break;
                                cancellation.ThrowIfCancellationRequested();
                                if (++count > MaximumArenaPlayerAccounts) throw new FormatException("ArenaPlayer scan exceeds its complete-response account bound");
                                var row = Object(JToken.ReadFrom(reader, settings));
                                string address = String(row["pubkey"]); SolanaAddress.Bytes(address);
                                if (!seen.Add(address)) throw new FormatException("ArenaPlayer scan contains duplicate addresses");
                                var account = Account(address, row["account"], 0, bytes);
                                if (account.Envelope == null) throw new FormatException("ArenaPlayer scan contains an absent account");
                                accumulate(account.Envelope, bindings.ArenaPlayer(account.Envelope, day));
                            }
                            if (reader.TokenType != JsonToken.EndArray) throw new FormatException("Truncated ArenaPlayer array");
                        }
                        else throw new FormatException("Unexpected ArenaPlayer result field");
                    }
                    if (!values || reader.TokenType != JsonToken.EndObject) throw new FormatException("Incomplete ArenaPlayer scan result");
                }
                else throw new FormatException("Unexpected RPC response field");
            }
            if (reader.TokenType != JsonToken.EndObject || reader.Read() || !version || !identity)
                throw new FormatException("Malformed or mismatched ArenaPlayer response");
            if (error != null)
            {
                if (rootFields.Contains("result") || error["code"]?.Type != JTokenType.Integer) throw new FormatException("Malformed RPC error");
                throw new RpcFailure((long)error["code"], String(error["message"]), error["data"]?.ToString(Formatting.None));
            }
            if (!slot.HasValue || slot.Value < minContextSlot) throw new FormatException("ArenaPlayer scan lacks a sufficiently fresh context");
            return slot.Value;
        }
        private static void RequireScanRead(JsonTextReader reader, JsonToken token)
        { if (!reader.Read() || reader.TokenType != token) throw new FormatException("Malformed ArenaPlayer response"); }
        private static string ScanProperty(JsonTextReader reader, HashSet<string> seen)
        {
            if (reader.TokenType != JsonToken.PropertyName || !(reader.Value is string name) || !seen.Add(name))
                throw new FormatException("Malformed or duplicate ArenaPlayer response property");
            return name;
        }

        // Only the root, result wrapper and result.value array may exceed a
        // small subtree budget. Every account, context, error and scalar is
        // checked without allocating strings or JSON nodes first. Syntax and
        // duplicate-property validation still belong to the JSON reader below.
        private sealed class ScanJsonBounds
        {
            private enum Scope { Root, Result, Rows, Bounded }
            private const int MaximumText = 4096, MaximumString = 1024, MaximumTokens = 128;
            private readonly string text;
            private readonly CancellationToken cancellation;
            private int at;
            public ScanJsonBounds(string text, CancellationToken cancellation)
            { this.text = text; this.cancellation = cancellation; }
            public void Validate()
            {
                int tokens = 0;
                Value(0, Scope.Root, -1, ref tokens); White();
                if (at != text.Length) throw new FormatException("Trailing ArenaPlayer response content");
            }
            private void Value(int depth, Scope scope, int start, ref int tokens)
            {
                cancellation.ThrowIfCancellationRequested(); White();
                if (depth > 12 || at == text.Length) throw new FormatException("ArenaPlayer JSON nesting or termination is invalid");
                if (scope == Scope.Bounded && start < 0) { start = at; tokens = 0; }
                if (start >= 0 && ++tokens > MaximumTokens) throw new FormatException("ArenaPlayer JSON subtree has too many tokens");
                char value = text[at];
                if (value == '{')
                {
                    at++; White(); int count = 0;
                    if (!Take('}'))
                    {
                        do
                        {
                            if (++count > 32) throw new FormatException("ArenaPlayer JSON object has too many properties");
                            if (start >= 0 && ++tokens > MaximumTokens) throw new FormatException("ArenaPlayer JSON subtree has too many tokens");
                            White(); int keyStart = at; Quoted(); int keyEnd = at; White();
                            if (!Take(':')) throw new FormatException("ArenaPlayer JSON property lacks a colon");
                            Scope child = Scope.Bounded;
                            // At most these two bounded property names need
                            // decoding; escaped spellings retain JSON semantics.
                            if ((scope == Scope.Root || scope == Scope.Result) && keyEnd - keyStart <= 64)
                            {
                                string key = JsonConvert.DeserializeObject<string>(text.Substring(keyStart, keyEnd - keyStart));
                                if (scope == Scope.Root && key == "result") child = Scope.Result;
                                if (scope == Scope.Result && key == "value") child = Scope.Rows;
                            }
                            Value(depth + 1, child, start, ref tokens); White();
                        } while (Take(','));
                        if (!Take('}')) throw new FormatException("ArenaPlayer JSON object is incomplete");
                    }
                }
                else if (value == '[')
                {
                    at++; White(); int count = 0;
                    if (!Take(']'))
                    {
                        do
                        {
                            if (++count > (scope == Scope.Rows ? MaximumArenaPlayerAccounts : MaximumTokens))
                                throw new FormatException("ArenaPlayer JSON array has too many values");
                            Value(depth + 1, Scope.Bounded, start, ref tokens); White();
                        } while (Take(','));
                        if (!Take(']')) throw new FormatException("ArenaPlayer JSON array is incomplete");
                    }
                }
                else if (value == '"') Quoted();
                else
                {
                    int scalar = at;
                    while (at < text.Length && text[at] != ',' && text[at] != '}' && text[at] != ']' && !char.IsWhiteSpace(text[at]))
                        if (++at - scalar > 64) throw new FormatException("ArenaPlayer JSON scalar is too long");
                    if (at == scalar) throw new FormatException("ArenaPlayer JSON value is absent");
                }
                if (start >= 0 && at - start > MaximumText) throw new FormatException("ArenaPlayer JSON subtree exceeds its text bound");
            }
            private void Quoted()
            {
                if (!Take('"')) throw new FormatException("ArenaPlayer JSON string is absent");
                int start = at; bool escaped = false;
                while (at < text.Length)
                {
                    char next = text[at++];
                    if (at - start > MaximumString) throw new FormatException("ArenaPlayer JSON string exceeds its text bound");
                    if (escaped) { escaped = false; continue; }
                    if (next == '\\') { escaped = true; continue; }
                    if (next == '"') return;
                }
                throw new FormatException("ArenaPlayer JSON string is incomplete");
            }
            private void White() { while (at < text.Length && char.IsWhiteSpace(text[at])) at++; }
            private bool Take(char expected) { if (at == text.Length || text[at] != expected) return false; at++; return true; }
        }
    }
}
