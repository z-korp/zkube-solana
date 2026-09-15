#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Execution;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Evidence
{
    public sealed class MoneyEvidenceCall
    {
        public string Boundary { get; }
        public string Operation { get; }
        internal MoneyEvidenceCall(string boundary, string operation) { Boundary = boundary; Operation = operation; }
    }
    // A finite evidence callback hold, never a production transport policy.
    public sealed class MoneyEvidenceDelay
    {
        private readonly TaskCompletionSource<bool> entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> released = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task Entered => entered.Task;
        public void Release() => released.TrySetResult(true);
        internal Task Wait() { entered.TrySetResult(true); return released.Task; }
    }
    // Explicit evidence graph. Each case begins disconnected. Native and
    // transport doubles live only in this conditional assembly, never in Startup
    // fallback paths; production uses the same MoneyClientServices composition.
    public sealed class MoneyEvidenceGraph
    {
        private readonly object gate = new object();
        private readonly List<MoneyEvidenceCall> calls = new List<MoneyEvidenceCall>();
        private readonly JObject inputs;
        private readonly Dictionary<string, JObject> baseAccounts, erAccounts;
        private readonly string pendingSignature;
        private bool confirmedFailure;
        private string delayedMethod;
        private MoneyEvidenceDelay delay;
        private int forbidden;
        private long observedNow;
        public MoneyClientServices Services { get; private set; }
        public string Scenario { get; }
        public string Label { get; }
        public string Owner => (string)inputs["owner"];
        public string SourceSha256 { get; }
        public Func<long> Clock { get; }
        public int ForbiddenCalls { get { lock (gate) return forbidden; } }
        public IReadOnlyList<MoneyEvidenceCall> Calls { get { lock (gate) return Array.AsReadOnly(calls.ToArray()); } }

        public static async Task<MoneyEvidenceGraph> Create(string scenario, string solanaJson, string sessionJson)
        {
            var data = JObject.Parse(MoneyEvidenceData.Json);
            if ((uint)data["schemaVersion"] != 1 || (string)data["evidenceClass"] != "offline-injected-money-overview")
                throw new FormatException("Unexpected generated money evidence schema");
            var selected = data["scenarios"].SingleOrDefault(row => (string)row["id"] == scenario)
                ?? throw new ArgumentException("Unknown money evidence scenario", nameof(scenario));
            var graph = new MoneyEvidenceGraph(data, selected);
            var storage = new MemoryStore(graph);
            graph.Services = new MoneyClientServices(solanaJson, sessionJson,
                new MoneyConnectionConfig((string)graph.inputs["base"], (string)graph.inputs["router"], (string)graph.inputs["expectedGenesis"]),
                new FixtureHttp(graph), new FixtureNative(graph), storage, graph.Clock, owner => new ZKube.Local.LocalProductStore(owner: owner));
            if (selected["pending"]?.Type == JTokenType.Object)
            {
                var pending = selected["pending"];
                await graph.Services.Journal.Begin(new PendingTransaction(graph.Owner, (string)pending["intent"],
                    (string)graph.inputs["base"], true, Convert.FromBase64String((string)pending["transaction"]),
                    (string)pending["blockhash"], (ulong)pending["lastValidBlockHeight"])).ConfigureAwait(false);
            }
            return graph;
        }
        private MoneyEvidenceGraph(JObject data, JToken selected)
        {
            inputs = (JObject)data["inputs"].DeepClone(); Scenario = (string)selected["id"]; Label = (string)selected["label"];
            observedNow = (long)inputs["now"];
            Clock = () => { lock (gate) return observedNow; };
            SourceSha256 = (string)data["sourceSha256"];
            if (SourceSha256?.Length != 64 || string.IsNullOrWhiteSpace(Label)) throw new FormatException("Generated evidence provenance is missing");
            baseAccounts = selected["baseAccounts"].ToDictionary(row => (string)row["address"], row => (JObject)row.DeepClone(), StringComparer.Ordinal);
            erAccounts = selected["erAccounts"].ToDictionary(row => (string)row["address"], row => (JObject)row.DeepClone(), StringComparer.Ordinal);
            pendingSignature = selected["pending"]?.Type == JTokenType.Object ? (string)selected["pending"]["signature"] : null;
        }
        public void ConfirmPendingFailure()
        {
            if (pendingSignature == null) throw new InvalidOperationException("This scenario has no pending transaction");
            lock (gate) confirmedFailure = true;
        }
        public void AdvanceClock(long seconds)
        {
            if (seconds <= 0) throw new ArgumentOutOfRangeException(nameof(seconds));
            lock (gate) observedNow = checked(observedNow + seconds);
        }
        public MoneyEvidenceDelay HoldNextRead(string method)
        {
            if (method != "getAccountInfo" && method != "getMultipleAccounts" && method != "getSignatureStatuses")
                throw new ArgumentException("Only the overview's finite account/status reads can be held", nameof(method));
            lock (gate)
            {
                if (delay != null) throw new InvalidOperationException("A read hold is already armed");
                delayedMethod = method; return delay = new MoneyEvidenceDelay();
            }
        }
        private void Record(string boundary, string operation) { lock (gate) calls.Add(new MoneyEvidenceCall(boundary, operation)); }
        private Exception Forbidden(string boundary, string operation)
        { lock (gate) { forbidden++; calls.Add(new MoneyEvidenceCall(boundary, operation)); } return new InvalidOperationException("Offline overview forbids " + boundary + " " + operation); }

        private sealed class FixtureHttp : IJsonRpcHttp
        {
            private readonly MoneyEvidenceGraph graph;
            public FixtureHttp(MoneyEvidenceGraph graph) { this.graph = graph; }
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested();
                var request = JObject.Parse(json); string method = (string)request["method"], route = endpoint.AbsoluteUri;
                bool isBase = route == (string)graph.inputs["base"], isRouter = route == (string)graph.inputs["router"], isEr = route == (string)graph.inputs["er"];
                if (!isBase && !isRouter && !isEr) throw graph.Forbidden("rpc-endpoint", route);
                graph.Record(isBase ? "base" : isRouter ? "router" : "er", method);
                MoneyEvidenceDelay hold = null;
                lock (graph.gate)
                    if (graph.delayedMethod == method) { hold = graph.delay; graph.delay = null; graph.delayedMethod = null; }
                // A released callback may arrive after caller cancellation. The
                // real transport and flow still own stale-result rejection.
                if (hold != null) await hold.Wait().ConfigureAwait(false);
                JObject Context(JToken value) => new JObject { ["context"] = graph.inputs["accountContext"].DeepClone(), ["value"] = value };
                JToken Account(string address)
                {
                    SolanaAddress.Bytes(address);
                    var rows = isBase ? graph.baseAccounts : graph.erAccounts;
                    if (!rows.TryGetValue(address, out var row)) return JValue.CreateNull();
                    return new JObject { ["owner"] = row["owner"], ["executable"] = row["executable"],
                        ["lamports"] = row["lamports"] ?? graph.inputs["accountLamports"], ["data"] = new JArray(row["data"], "base64") };
                }
                JToken result;
                switch (method)
                {
                    case "getGenesisHash" when isBase: result = graph.inputs["expectedGenesis"].DeepClone(); break;
                    case "getAccountInfo" when !isRouter: result = Context(Account((string)request["params"][0])); break;
                    case "getMultipleAccounts" when !isRouter:
                        var addresses = request["params"][0].Values<string>().ToArray();
                        if (addresses.Length > SolanaRpcTransport.MaximumBatchAccounts) throw new FormatException("Unbounded evidence read");
                        result = Context(new JArray(addresses.Select(Account))); break;
                    case "getDelegationStatus" when isRouter:
                        result = graph.erAccounts.ContainsKey((string)request["params"][0]) ? graph.inputs["delegated"].DeepClone() : new JObject { ["isDelegated"] = false }; break;
                    case "getSignatureStatuses" when isBase:
                        if (graph.pendingSignature == null || request["params"][0].Count() != 1 || (string)request["params"][0][0] != graph.pendingSignature)
                            throw graph.Forbidden("rpc", "unrecognized signature");
                        lock (graph.gate) result = graph.inputs[graph.confirmedFailure ? "confirmedFailure" : "processed"].DeepClone();
                        break;
                    case "getBlockHeight" when isBase && graph.pendingSignature != null: result = graph.inputs["height"].DeepClone(); break;
                    default: throw graph.Forbidden("rpc", method);
                }
                var text = new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString(Newtonsoft.Json.Formatting.None);
                if (Encoding.UTF8.GetByteCount(text) > maximumResponseBytes) throw new FormatException("Evidence RPC response exceeds bound");
                return text;
            }
        }
        private sealed class FixtureNative : INativeDeviceKeyLifecycle
        {
            private readonly MoneyEvidenceGraph graph;
            public FixtureNative(MoneyEvidenceGraph graph) { this.graph = graph; }
            public Task<string> Request(string json)
            {
                var request = JObject.Parse(json); string operation = (string)request["operation"];
                if (operation != "authorize" && operation != "disconnect") throw graph.Forbidden("native", operation);
                string ownerBytes = Convert.ToBase64String(SolanaAddress.Bytes(graph.Owner));
                if (request["owner"] != null && (string)request["owner"] != ownerBytes) throw graph.Forbidden("native", "another owner");
                graph.Record("native", operation);
                return Task.FromResult(new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = ownerBytes }.ToString());
            }
            public Task<byte[]> LoadDeviceSeed(string owner) { CheckOwner(owner); graph.Record("native", "load-absent-device"); return Task.FromResult<byte[]>(null); }
            public Task<byte[]> LoadCandidateSeed(string owner) { CheckOwner(owner); graph.Record("native", "load-absent-candidate"); return Task.FromResult<byte[]>(null); }
            public Task<byte[]> CreateDeviceSeed(string owner) => throw graph.Forbidden("native", "create-device");
            public Task<byte[]> CreateCandidateSeed(string owner) => throw graph.Forbidden("native", "create-candidate");
            public Task RemoveDeviceSeed(string owner)
            { CheckOwner(owner); graph.Record("native", "remove-absent-device"); return Task.CompletedTask; }
            public Task PromoteCandidateSeed(string owner, byte[] active, byte[] candidate) => throw graph.Forbidden("native", "promote-candidate");
            private void CheckOwner(string owner) { if (owner != graph.Owner) throw graph.Forbidden("native", "another owner"); }
        }
        private sealed class MemoryStore : IPublicClientStore
        {
            private readonly MoneyEvidenceGraph graph;
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public MemoryStore(MoneyEvidenceGraph graph) { this.graph = graph; }
            private void Check(string owner, string field)
            {
                if (owner != graph.Owner || (field != "journal" && field != "session" && field != "campaign" && field != "daily"))
                    throw graph.Forbidden("storage", "unrecognized owner or field");
            }
            public Task<string> Read(string owner, string field)
            { Check(owner, field); graph.Record("storage", "read-" + field); lock (values) { values.TryGetValue(field, out var value); return Task.FromResult(value); } }
            public Task Write(string owner, string field, string value) => throw graph.Forbidden("storage", "unguarded write");
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                Check(owner, field); graph.Record("storage", "compare-exchange-" + field);
                lock (values) { values.TryGetValue(field, out var old); if (old != expected) return Task.FromResult(false); values[field] = value; return Task.FromResult(true); }
            }
        }
    }
}
#endif
