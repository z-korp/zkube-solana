#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Evidence
{
    // An exact finite ledger, not a gameplay engine. Only generated transaction
    // bytes and generated oracle snapshots can advance it. No network fallback.
    public sealed class MoneyPlayableEvidenceGraph
    {
        private readonly object gate = new object();
        private readonly JObject inputs, transport;
        private readonly JToken[] steps;
        private readonly Dictionary<string, JObject> baseAccounts;
        private readonly Dictionary<string, Receipt> sent = new Dictionary<string, Receipt>();
        private readonly List<MoneyEvidenceCall> calls = new List<MoneyEvidenceCall>();
        private JObject active;
        private int cursor, forbidden;
        private bool entered, delegated, consumed, activeKey = true, holdConfirmation, holdCopyback, commitAccepted;
        private bool faultAfterClear, faultNextRead;
        private MoneyEvidenceDelay readHold;
        private string heldMethod;
        private sealed class Receipt { public JToken Step; public bool Confirmed; }
        public MoneyClientServices Services { get; private set; }
        public string Owner => (string)inputs["owner"];
        public string Address { get; }
        public string SourceSha256 { get; }
        public string Mode => (string)inputs["mode"];
        public string Label => "Offline evidence · " + (Mode == "daily" ? "Daily" : "Campaign") + " playthrough";
        public Func<long> Clock { get; }
        public int ForbiddenCalls { get { lock (gate) return forbidden; } }
        public int SubmittedCount { get { lock (gate) return sent.Count; } }
        public int StepIndex { get { lock (gate) return cursor; } }
        public bool Consumed { get { lock (gate) return consumed; } }
        public string NextCommand { get { lock (gate) return cursor < steps.Length ? (string)steps[cursor]["command"]["kind"] : null; } }
        public IReadOnlyList<MoneyEvidenceCall> Calls { get { lock (gate) return calls.ToArray(); } }
        public sealed class InputStep
        {
            public string Kind { get; }
            public byte Row { get; }
            public byte Start { get; }
            public byte Destination { get; }
            public byte Column { get; }
            internal InputStep(JToken command)
            { Kind = (string)command["kind"]; Row = (byte?)command["row"] ?? 0; Start = (byte?)command["start"] ?? 0;
                Destination = (byte?)command["destination"] ?? 0; Column = (byte?)command["column"] ?? 0; }
        }
        public InputStep NextInput { get { lock (gate) return cursor < steps.Length ? new InputStep(steps[cursor]["command"]) : null; } }
        public static bool Supports(string scenario) => scenario == "campaign-playable" || scenario == "daily-playable";
        public static Task<MoneyPlayableEvidenceGraph> Create(string solanaJson, string sessionJson) => Create(MoneyPlayableEvidenceData.Json, solanaJson, sessionJson);
        public static Task<MoneyPlayableEvidenceGraph> CreateScenario(string scenario, string solanaJson, string sessionJson)
        {
            if (!Supports(scenario)) throw new ArgumentException("Unknown playable scenario", nameof(scenario));
            return Create(scenario == "daily-playable" ? MoneyPlayableEvidenceData.DailyJson : MoneyPlayableEvidenceData.Json, solanaJson, sessionJson);
        }

        public static async Task<MoneyPlayableEvidenceGraph> Create(string fixture, string solanaJson, string sessionJson)
        {
            var data = JObject.Parse(fixture);
            string mode = (string)data["inputs"]?["mode"];
            if ((int)data["schemaVersion"] != 1 || (mode != "campaign" && mode != "daily") ||
                (string)data["evidenceClass"] != "offline-synthetic-money-" + mode + "-trajectory")
                throw new FormatException("Unexpected playable evidence schema");
            var graph = new MoneyPlayableEvidenceGraph(data);
            graph.Services = new MoneyClientServices(solanaJson, sessionJson,
                new MoneyConnectionConfig((string)graph.transport["base"], (string)graph.transport["router"], (string)graph.transport["expectedGenesis"]),
                new Http(graph), new Native(graph), new Memory(graph), graph.Clock, () => Bytes(graph.inputs["clientSeed"]));
            var token = graph.baseAccounts[(string)graph.inputs["sessionToken"]];
            var session = graph.Services.Tokens.Decode(Envelope(token));
            await graph.Services.Sessions.Replace(await graph.Services.Sessions.Load(graph.Owner).ConfigureAwait(false),
                new SessionRecords(graph.Owner, new SessionRecord(graph.Owner, (string)graph.inputs["device"], (string)token["address"], session.ValidUntil), null)).ConfigureAwait(false);
            return graph;
        }
        private MoneyPlayableEvidenceGraph(JObject data)
        {
            inputs = (JObject)data["inputs"].DeepClone(); transport = (JObject)data["transport"].DeepClone();
            entered = delegated = Mode == "campaign";
            active = (JObject)data["initial"].DeepClone(); Address = (string)active["address"];
            SourceSha256 = (string)data["sourceSha256"];
            if (SourceSha256?.Length != 64) throw new FormatException("Missing playable evidence provenance");
            baseAccounts = transport["baseAccounts"].ToDictionary(row => (string)row["address"], row => (JObject)row.DeepClone(), StringComparer.Ordinal);
            steps = data["steps"].Select(row => row.DeepClone()).Concat(new JToken[] {
                new JObject { ["command"] = new JObject { ["kind"] = "commit" }, ["transaction"] = data["settlement"]["commit"].DeepClone() },
                new JObject { ["command"] = new JObject { ["kind"] = "consume" }, ["transaction"] = data["settlement"]["consume"].DeepClone() }
            }).ToArray();
            foreach (var step in steps.Where(value => value["transaction"]?.Type == JTokenType.Object)) OnBase(step);
            long now = (long)inputs["now"]; Clock = () => now;
            using var device = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            if (device.Address != (string)inputs["device"] || (long)transport["now"] != now ||
                (string)transport["blockhash"]["value"]["blockhash"] != (string)inputs["blockhash"])
                throw new FormatException("Playable fixture identity, clock or blockhash disagrees");
        }
        private static byte[] Bytes(JToken value) => Convert.FromBase64String((string)value);
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"], (bool)row["executable"], Bytes(row["data"]));
        private void Record(string boundary, string operation) { lock (gate) calls.Add(new MoneyEvidenceCall(boundary, operation)); }
        private Exception Forbidden(string operation)
        { lock (gate) { forbidden++; Record("synthetic-playable", "forbidden-" + operation); } return new InvalidOperationException("Playable evidence forbids " + operation); }
        private void OwnerOnly(string owner) { if (owner != Owner) throw Forbidden("another-owner"); }
        private static bool OnBase(JToken step)
        {
            string route = (string)step["transaction"]?["route"];
            if (route != "solana-base" && route != "magicblock-er") throw new FormatException("Unknown playable transaction route");
            return route == "solana-base";
        }
        private JToken Expected(bool baseLayer)
        {
            lock (gate)
            {
                if (cursor >= steps.Length || steps[cursor]["transaction"]?.Type != JTokenType.Object ||
                    OnBase(steps[cursor]) != baseLayer)
                    throw Forbidden("unexpected-transaction-route-or-order");
                return steps[cursor];
            }
        }
        private void Exact(JToken expected, string field, string actual)
        { if ((string)expected["transaction"][field] != actual) throw Forbidden("unrecognized-" + field); }
        private void Apply(JToken step)
        {
            if (!ReferenceEquals(steps[cursor], step)) throw Forbidden("out-of-order-acceptance");
            string kind = (string)step["command"]["kind"];
            if (kind == "entry")
            {
                if (entered || Mode != "daily") throw Forbidden("duplicate-entry");
                InstallAccounts("entryAccounts");
                active = (JObject)step["account"].DeepClone(); entered = delegated = true;
            }
            else if (kind == "commit") { commitAccepted = true; if (!holdCopyback) delegated = false; }
            else if (kind == "consume")
            {
                if (delegated) throw Forbidden("consume-before-copyback");
                consumed = true; InstallAccounts("resultAccounts");
                baseAccounts[(string)transport["playerAfter"]["address"]] = (JObject)transport["playerAfter"].DeepClone();
            }
            else active = (JObject)step["account"].DeepClone();
            cursor++; Record("synthetic-ledger", "accepted-" + kind);
        }
        private void InstallAccounts(string name)
        {
            foreach (var row in transport[name]) baseAccounts[(string)row["address"]] = (JObject)row.DeepClone();
        }
        public async Task DeliverNextOracle()
        {
            if (await Services.Journal.Load(Owner).ConfigureAwait(false) != null) throw new InvalidOperationException("Reconcile the request before delivering its oracle fixture");
            lock (gate)
            {
                if (NextCommand != "oracleVrf") throw new InvalidOperationException("No oracle output is due");
                Apply(steps[cursor]);
            }
        }
        public void HoldNextConfirmation()
        { lock (gate) { if (holdConfirmation || sent.Values.Any(value => !value.Confirmed)) throw new InvalidOperationException("Confirmation is already held"); holdConfirmation = true; } }
        public void ConfirmPending()
        {
            lock (gate)
            {
                var receipt = sent.Values.SingleOrDefault(value => !value.Confirmed) ?? throw new InvalidOperationException("No pending fixture receipt");
                receipt.Confirmed = true; Apply(receipt.Step);
            }
        }
        public void HoldCopyback() { lock (gate) { if (commitAccepted) throw new InvalidOperationException("Commit already accepted"); holdCopyback = true; } }
        public void DeliverCopyback()
        { lock (gate) { if (!commitAccepted || !holdCopyback || !delegated) throw new InvalidOperationException("No copy-back is due"); delegated = false; Record("synthetic-ledger", "copyback"); } }
        public void FailFirstReadAfterJournalClear() { lock (gate) faultAfterClear = true; }
        public MoneyEvidenceDelay HoldNextRead(string method)
        {
            if (method != "getAccountInfo" && method != "getMultipleAccounts" && method != "getSignatureStatuses") throw new ArgumentException("Unknown finite read", nameof(method));
            lock (gate) { if (readHold != null) throw new InvalidOperationException("A read is already held"); heldMethod = method; return readHold = new MoneyEvidenceDelay(); }
        }
        private JObject Context(JToken value) => new JObject { ["context"] = transport["accountContext"].DeepClone(), ["value"] = value };
        private JToken Account(string address, bool er)
        {
            SolanaAddress.Bytes(address);
            lock (gate)
            {
                JObject row = null;
                if (address == Address)
                {
                    if (entered && !consumed && (!er || delegated)) row = active;
                }
                else if (!er) baseAccounts.TryGetValue(address, out row);
                if (row == null) return JValue.CreateNull();
                return new JObject { ["owner"] = address == Address && !er && delegated ? PlanningConstants.DelegationProgram : row["owner"],
                    ["executable"] = row["executable"], ["lamports"] = row["lamports"] ?? transport["accountLamports"], ["data"] = new JArray(row["data"], "base64") };
            }
        }
        private sealed class Http : IJsonRpcHttp
        {
            private readonly MoneyPlayableEvidenceGraph graph;
            public Http(MoneyPlayableEvidenceGraph graph) { this.graph = graph; }
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested(); var request = JObject.Parse(json);
                string method = (string)request["method"], route = endpoint.AbsoluteUri;
                bool baseLayer = route == (string)graph.transport["base"], router = route == (string)graph.transport["router"], er = route == (string)graph.transport["er"];
                if (!baseLayer && !router && !er) throw graph.Forbidden("endpoint");
                graph.Record(baseLayer ? "synthetic-base" : router ? "synthetic-router" : "synthetic-er", method);
                MoneyEvidenceDelay hold = null;
                lock (graph.gate)
                {
                    if (graph.heldMethod == method) { hold = graph.readHold; graph.readHold = null; graph.heldMethod = null; }
                    if (graph.faultNextRead && (method == "getAccountInfo" || method == "getMultipleAccounts"))
                    { graph.faultNextRead = false; throw new IOException("Synthetic accepted-action readback unavailable"); }
                }
                if (hold != null) await hold.Wait().ConfigureAwait(false);
                JToken result;
                switch (method)
                {
                    case "getGenesisHash" when baseLayer: result = graph.transport["expectedGenesis"].DeepClone(); break;
                    case "getIdentity" when router: result = graph.transport["validator"].DeepClone(); break;
                    case "getAccountInfo" when !router: result = graph.Context(graph.Account((string)request["params"][0], er)); break;
                    case "getMultipleAccounts" when !router:
                        if (request["params"][0].Count() > SolanaRpcTransport.MaximumBatchAccounts) throw graph.Forbidden("unbounded-accounts");
                        result = graph.Context(new JArray(request["params"][0].Values<string>().Select(address => graph.Account(address, er)))); break;
                    case "getDelegationStatus" when router:
                        lock (graph.gate) result = (string)request["params"][0] == graph.Address && graph.delegated ? graph.transport["delegated"].DeepClone() : new JObject { ["isDelegated"] = false }; break;
                    case "getMinimumBalanceForRentExemption" when !router:
                        if ((int)request["params"][0] != 0) throw graph.Forbidden("unknown-rent-size"); result = graph.transport["rent"].DeepClone(); break;
                    case "getLatestBlockhash" when !router:
                        graph.Expected(baseLayer); result = graph.transport["blockhash"].DeepClone(); break;
                    case "getFeeForMessage" when !router:
                        graph.Exact(graph.Expected(baseLayer), "message", (string)request["params"][0]); result = graph.transport["fee"].DeepClone(); break;
                    case "getBalance" when !router:
                        if ((string)request["params"][0] != (string)graph.inputs["device"]) throw graph.Forbidden("unexpected-fee-payer");
                        result = graph.Context(graph.baseAccounts[(string)graph.inputs["device"]]["lamports"].DeepClone()); break;
                    case "simulateTransaction" when baseLayer:
                        graph.Exact(graph.Expected(true), "bytes", (string)request["params"][0]); result = graph.transport["simulation"].DeepClone(); break;
                    case "sendTransaction" when !router:
                        var step = graph.Expected(baseLayer); string transaction = (string)request["params"][0]; graph.Exact(step, "bytes", transaction);
                        string signature = TransactionSignatures.ValidateFullySigned(Convert.FromBase64String(transaction));
                        var pending = await graph.Services.Journal.Load(graph.Owner).ConfigureAwait(false);
                        if (pending == null || pending.Signature != signature || pending.IsBase != baseLayer || pending.Endpoint != route ||
                            !pending.Transaction.SequenceEqual(Convert.FromBase64String(transaction))) throw graph.Forbidden("send-before-matching-journal");
                        lock (graph.gate)
                        {
                            if (graph.sent.ContainsKey(signature)) throw graph.Forbidden("duplicate-send");
                            var receipt = new Receipt { Step = step, Confirmed = !graph.holdConfirmation }; graph.holdConfirmation = false;
                            graph.sent.Add(signature, receipt); if (receipt.Confirmed) graph.Apply(step); result = new JValue(signature);
                        }
                        break;
                    case "getSignatureStatuses" when !router:
                        lock (graph.gate)
                        {
                            if (request["params"][0].Count() != 1 || !graph.sent.TryGetValue((string)request["params"][0][0], out var receipt)) throw graph.Forbidden("unknown-signature");
                            bool onBase = OnBase(receipt.Step);
                            if (onBase != baseLayer || (bool?)request["params"][1]?["searchTransactionHistory"] != true) throw graph.Forbidden("wrong-receipt-ledger");
                            result = graph.Context(new JArray { new JObject { ["slot"] = graph.transport["accountContext"]["slot"].DeepClone(),
                                ["confirmationStatus"] = receipt.Confirmed ? "confirmed" : "processed", ["err"] = null } });
                        }
                        break;
                    case "getBlockHeight" when !router: result = graph.transport["height"].DeepClone(); break;
                    default: throw graph.Forbidden(method);
                }
                string response = new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString(Newtonsoft.Json.Formatting.None);
                if (Encoding.UTF8.GetByteCount(response) > maximumResponseBytes) throw new FormatException("Playable response exceeds bound");
                return response;
            }
        }
        private sealed class Native : INativeDeviceKeyLifecycle
        {
            private readonly MoneyPlayableEvidenceGraph graph;
            public Native(MoneyPlayableEvidenceGraph graph) { this.graph = graph; }
            public Task<string> Request(string json)
            {
                var request = JObject.Parse(json); string operation = (string)request["operation"], owner = Convert.ToBase64String(SolanaAddress.Bytes(graph.Owner));
                if (request["owner"] != null && (string)request["owner"] != owner) throw graph.Forbidden("another-wallet-owner");
                if (operation != "authorize" && operation != "disconnect") throw graph.Forbidden("wallet-" + operation);
                graph.Record("synthetic-native", operation);
                return Task.FromResult(new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = owner }.ToString());
            }
            public Task<byte[]> LoadDeviceSeed(string owner)
            { graph.OwnerOnly(owner); graph.Record("synthetic-native", "load-device"); lock (graph.gate) return Task.FromResult(graph.activeKey ? Enumerable.Repeat((byte)2, 32).ToArray() : null); }
            public Task RemoveDeviceSeed(string owner)
            { graph.OwnerOnly(owner); lock (graph.gate) { graph.activeKey = false; graph.Record("synthetic-native", "remove-device"); } return Task.CompletedTask; }
            public Task<byte[]> LoadCandidateSeed(string owner) { graph.OwnerOnly(owner); return Task.FromResult<byte[]>(null); }
            public Task<byte[]> CreateDeviceSeed(string owner) => throw graph.Forbidden("create-device");
            public Task<byte[]> CreateCandidateSeed(string owner) => throw graph.Forbidden("create-candidate");
            public Task PromoteCandidateSeed(string owner, byte[] active, byte[] candidate) => throw graph.Forbidden("promote-candidate");
        }
        private sealed class Memory : IPublicClientStore
        {
            private readonly MoneyPlayableEvidenceGraph graph;
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public Memory(MoneyPlayableEvidenceGraph graph) { this.graph = graph; }
            private void Check(string owner, string field)
            { graph.OwnerOnly(owner); if (field != "session" && field != "journal" && field != "campaign" && field != "daily") throw graph.Forbidden("unknown-store-field"); }
            public Task<string> Read(string owner, string field)
            { Check(owner, field); lock (values) return Task.FromResult(values.TryGetValue(field, out var value) ? value : null); }
            public Task Write(string owner, string field, string value) => throw graph.Forbidden("unguarded-write");
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                Check(owner, field); lock (values)
                {
                    values.TryGetValue(field, out var current); if (current != expected) return Task.FromResult(false);
                    values[field] = value;
                    lock (graph.gate)
                    {
                        if (field == "journal" && value == null && graph.faultAfterClear) { graph.faultAfterClear = false; graph.faultNextRead = true; }
                        graph.Record("synthetic-store", (value == null ? "clear-" : "commit-") + field);
                    }
                    return Task.FromResult(true);
                }
            }
        }
    }
}
#endif
