using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Tests
{
    public sealed class TestNative : INativeWalletTransport, IDisposable
    {
        private readonly ConcurrentQueue<string> events;
        public readonly ConcurrentQueue<string> Operations = new ConcurrentQueue<string>();
        public string Owner, SavedOwner;
        // Every payload the owner's wallet was asked to sign, as it was given.
        public readonly System.Collections.Generic.List<byte[]> Asked = new System.Collections.Generic.List<byte[]>();
        public byte[] Seed;
        public int Calls, KeyLoads, Creations, Disconnects, OwnerPrompts;
        public bool Disposed, RejectDisconnect, Reject, AllowSigning, ForbidRequests, ForbidKeyReads, ForbidKeyCreation;
        public Func<bool> AllowCreation = () => false;
        public Func<JObject, Task<JObject>> Reply;
        public TaskCompletionSource<bool> Entered, Release, SignEntered, SignRelease;
        public TestNative(ConcurrentQueue<string> events = null) { this.events = events; }
        public async Task<string> Request(string json)
        {
            if (events != null) await Task.Yield();
            Calls++; events?.Enqueue("wallet");
            if (ForbidRequests) throw new InvalidOperationException("Unexpected wallet request");
            var request = JObject.Parse(json); string operation = (string)request["operation"];
            Operations.Enqueue(operation);
            JObject response;
            if (Reply != null) response = await Reply(request);
            else
            {
                response = new JObject { ["owner"] = Owner == null ? request["owner"] : Convert.ToBase64String(SolanaAddress.Bytes(Owner)) };
                if (operation == "disconnect")
                {
                    Disconnects++;
                    if (RejectDisconnect) { response["ok"] = false; response["error"] = "wallet-rejected"; }
                }
                else if (operation == "signTransactions")
                {
                    if (!AllowSigning) throw new InvalidOperationException("Unexpected signing request");
                    lock (Asked) Asked.Add(Convert.FromBase64String((string)request["transaction"]));
                    OwnerPrompts++; SignEntered?.TrySetResult(true); if (SignRelease != null) await SignRelease.Task;
                    if (Reject) { response["ok"] = false; response["error"] = "wallet-rejected"; }
                    else
                    {
                        using var signer = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
                        response["transaction"] = Convert.ToBase64String(signer.PartialSign(Convert.FromBase64String((string)request["transaction"])));
                    }
                }
                else { Entered?.TrySetResult(true); if (Release != null) await Release.Task; }
            }
            response["requestId"] ??= request["requestId"]; response["ok"] ??= true;
            return response.ToString();
        }
        public Task<byte[]> LoadDeviceSeed(bool create)
        {
            KeyLoads++;
            if (ForbidKeyReads) throw new InvalidOperationException("Unexpected device key read");
            if (create && ForbidKeyCreation) throw new InvalidOperationException("Unexpected device key creation");
            if (create && Seed == null)
            {
                if (!AllowCreation()) throw new InvalidOperationException("Unexpected device key creation");
                Seed = Enumerable.Repeat((byte)2, 32).ToArray(); Creations++;
            }
            return Task.FromResult(Seed?.ToArray());
        }
        public Task<byte[]> LoadAuthorizedOwner() => Task.FromResult(SavedOwner == null ? null : SolanaAddress.Bytes(SavedOwner));
        public void Dispose() { Disposed = true; }
    }

    // The Clock sysvar account a cluster would return at this Unix time.
    public static class TestClock
    {
        public static JObject Sysvar(long unixTime)
        {
            var data = new byte[40];
            BitConverter.GetBytes(unixTime).CopyTo(data, 32);
            return new JObject { ["address"] = ZKube.Integration.Client.CadenceObservation.ClockSysvar,
                ["owner"] = "Sysvar1111111111111111111111111111111111111", ["executable"] = false,
                ["data"] = Convert.ToBase64String(data) };
        }
    }

    // A reply an endpoint gives as a JSON-RPC error.
    public sealed class RpcErrorReply : Exception
    {
        public long Code { get; }
        public RpcErrorReply(long code, string message) : base(message) { Code = code; }
    }
    public sealed class TestHttp : IJsonRpcHttp, IPublicReadHttp, IDisposable
    {
        public readonly ConcurrentQueue<JObject> Requests = new ConcurrentQueue<JObject>();
        public Func<Uri, JObject, CancellationToken, Task<JToken>> Reply;
        public bool Disposed;
        // What a MagicBlock rollup answers, as probed on Devnet on 2026-10-05. It
        // has no getMinimumBalanceForRentExemption and no getRecentPrioritizationFees;
        // anything not listed gets the rollup's own Method not found, on every double.
        public static readonly string[] RollupAnswers = { "getHealth", "getLatestBlockhash", "isBlockhashValid", "getSignatureStatuses",
            "getMultipleAccounts", "getAccountInfo", "getBalance", "getSlot", "getBlockHeight", "getEpochInfo", "getGenesisHash",
            "getFeeForMessage", "sendTransaction" };
        public const string RollupHost = "er.invalid";
        public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            var request = JObject.Parse(json); request["endpoint"] = endpoint.AbsoluteUri; Requests.Enqueue(request);
            JObject Refused(long code, string message) => new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"],
                ["error"] = new JObject { ["code"] = code, ["message"] = message } };
            if (endpoint.Host == RollupHost && !RollupAnswers.Contains((string)request["method"])) return Refused(-32601, "Method not found").ToString();
            // The rollup's Magic context is megabytes: a read that names it gets more than any bound allows, as on Devnet.
            if (((string)request["method"]).StartsWith("get") && json.Contains(ZKube.Integration.Planning.PlanningConstants.MagicContext))
                throw new FormatException("RPC response exceeds its bound");
            try
            {
                var result = await Reply(endpoint, request, cancellation);
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
            }
            catch (RpcErrorReply error) { return Refused(error.Code, error.Message).ToString(); }
        }
        // What the rollup was asked.
        public string[] AskedOfTheRollup => Requests.ToArray().Where(request => new Uri((string)request["endpoint"]).Host == RollupHost)
            .Select(request => (string)request["method"]).Distinct().OrderBy(method => method, StringComparer.Ordinal).ToArray();
        // The public read model's answer to a GET; absent, it is down.
        public Func<Uri, string> Read;
        public readonly ConcurrentQueue<Uri> Reads = new ConcurrentQueue<Uri>();
        public Task<string> Get(Uri endpoint, int maximumResponseBytes, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested(); Reads.Enqueue(endpoint);
            if (Read == null) throw new System.Net.Http.HttpRequestException("read model is down");
            string body = Read(endpoint);
            if (body.Length > maximumResponseBytes) throw new FormatException("response exceeds its bound");
            return Task.FromResult(body);
        }
        public static JObject Context(JToken value, ulong slot = 1000) =>
            new JObject { ["context"] = new JObject { ["slot"] = slot }, ["value"] = value };
        public void Dispose() { Disposed = true; }
    }

    public sealed class TestMemory : IPublicClientStore, IDisposable
    {
        private readonly Dictionary<string, string> values = new Dictionary<string, string>();
        private readonly ConcurrentQueue<string> events;
        public bool Fail, FailBeforeCommit, Disposed;
        public int Calls, Reads, Exchanges;
        public Func<string, string, string, string> ReadOverride;
        public Action AfterJournalComplete;
        public TestMemory(ConcurrentQueue<string> events = null) { this.events = events; }
        public string Peek(string owner, string field)
        { lock (values) return values.TryGetValue(owner + field, out var value) ? value : null; }
        public Task<string> Read(string owner, string field)
        {
            lock (values)
            {
                Calls++; Reads++; var value = Peek(owner, field);
                return Task.FromResult(ReadOverride == null ? value : ReadOverride(owner, field, value));
            }
        }
        public Task Write(string owner, string field, string value)
        {
            lock (values)
            {
                Calls++;
                if (Fail) throw new IOException("Synthetic storage failure");
                values[owner + field] = value;
            }
            return Task.CompletedTask;
        }
        public async Task<bool> CompareExchange(string owner, string field, string expected, string value)
        {
            if (events != null) await Task.Yield();
            lock (values)
            {
                Calls++; Exchanges++;
                if (Fail || FailBeforeCommit) throw new IOException("Synthetic durable commit failure");
                if (Peek(owner, field) != expected) return false;
                values[owner + field] = value;
                if (field == "journal" && value != null) events?.Enqueue("journal");
                if (field == "journal" && value == null) AfterJournalComplete?.Invoke();
                return true;
            }
        }
        public void Dispose() { Disposed = true; }
    }
}
