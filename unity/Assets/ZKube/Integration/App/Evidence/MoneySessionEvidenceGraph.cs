#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Client;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Evidence
{
    // Shared finite synthetic transaction ledger for session and economy cases.
    // The read-only overview graph continues forbidding all new signing.
    public sealed class MoneySessionEvidenceGraph
    {
        private readonly object gate = new object();
        private readonly JObject inputs, scenario;
        private readonly Dictionary<string, JObject> before, after, er;
        private readonly List<MoneyEvidenceCall> calls = new List<MoneyEvidenceCall>();
        private readonly byte[] ownerSeed, candidateSeed;
        private byte[] active, candidate;
        private bool sent, signed, advanced, pendingObserved;
        private bool failReadback, corruptReadback, timeoutReadback, readbackFaultArmed;
        private string corruptReadbackTarget;
        private bool rejectClaimPeerReads;
        private int forbidden;
        private MoneyEvidenceDelay walletHold, readHold;
        private string heldMethod;
        private long now;
        public MoneyClientServices Services { get; private set; }
        public string Owner => (string)inputs["owner"];
        public string Scenario => (string)scenario["id"];
        public string Label => (string)scenario["label"];
        public string Operation => (string)scenario["operation"];
        public uint KreditPack => (uint?)scenario["pack"] ?? 0;
        public uint ClaimDay => (uint?)scenario["day"] ?? 0;
        public string ClaimKind => (string)scenario["kind"];
        public byte ProfileEmblem => (byte?)scenario["emblem"] ?? 0;
        public byte ProfileBorder => (byte?)scenario["frame"] ?? 0;
        private bool OwnerSignatureRequired => (bool?)scenario["transaction"]?["ownerRequired"] ?? true;
        private string FeePayer => (string)scenario["transaction"]?["feePayer"] ?? Owner;
        public string SourceSha256 { get; }
        public string FixtureClass { get; }
        public Func<long> Clock { get; }
        public IReadOnlyList<MoneyEvidenceCall> Calls { get { lock (gate) return calls.ToArray(); } }
        public int ForbiddenCalls { get { lock (gate) return forbidden; } }
        public bool HasActiveKey { get { lock (gate) return active != null; } }
        public bool HasCandidateKey { get { lock (gate) return candidate != null; } }
        public string SentSignature { get { lock (gate) return sent ? Signature : null; } }
        private bool Failure => (bool)scenario["failure"];
        private bool Confirmed => advanced || (string)scenario["status"] == "confirmed";
        private bool Accepted => sent && Confirmed && !Failure;
        private string Signature => TransactionSignatures.ValidateFullySigned(Convert.FromBase64String((string)scenario["transaction"]["signed"]));
        private static JObject Source(string selected)
        {
            foreach (string json in new[] { MoneySessionEvidenceData.Json, MoneyEconomyEvidenceData.Json, MoneyClaimEvidenceData.Json, MoneyProfileEvidenceData.Json })
            {
                var data = JObject.Parse(json);
                if (data["scenarios"].Any(row => (string)row["id"] == selected)) return data;
            }
            return null;
        }
        public static bool Supports(string value) => Source(value) != null;
        public static async Task<MoneySessionEvidenceGraph> Create(string selected, string solanaJson, string sessionJson)
        {
            var data = Source(selected) ?? throw new ArgumentException("Unknown synthetic transaction scenario", nameof(selected));
            string family = (string)data["evidenceClass"];
            if ((int)data["schemaVersion"] != 1 || (family != "offline-synthetic-money-session" && family != "offline-synthetic-money-economy" && family != "offline-synthetic-money-claims" && family != "offline-synthetic-money-profile"))
                throw new FormatException("Unexpected synthetic session evidence schema");
            var row = data["scenarios"].SingleOrDefault(item => (string)item["id"] == selected) as JObject
                ?? throw new ArgumentException("Unknown synthetic session scenario", nameof(selected));
            var graph = new MoneySessionEvidenceGraph(data, row); var storage = new Memory(graph);
            graph.Services = new MoneyClientServices(solanaJson, sessionJson,
                new MoneyConnectionConfig((string)graph.inputs["base"], (string)graph.inputs["router"], (string)graph.inputs["expectedGenesis"]),
                new Http(graph), new Native(graph), storage, graph.Clock);
            if (row["active"]?.Type == JTokenType.Object)
            {
                var record = row["active"];
                await graph.Services.Sessions.Replace(await graph.Services.Sessions.Load(graph.Owner).ConfigureAwait(false),
                    new SessionRecords(graph.Owner, new SessionRecord(graph.Owner, (string)record["signer"], (string)record["token"], (long)record["validUntil"]), null)).ConfigureAwait(false);
            }
            return graph;
        }
        private MoneySessionEvidenceGraph(JObject data, JObject selected)
        {
            inputs = (JObject)data["inputs"].DeepClone(); scenario = (JObject)selected.DeepClone();
            SourceSha256 = (string)data["sourceSha256"];
            FixtureClass = (string)data["evidenceClass"];
            if (SourceSha256?.Length != 64 || string.IsNullOrWhiteSpace(Label)) throw new FormatException("Missing synthetic evidence provenance");
            Dictionary<string, JObject> Rows(string field) => scenario[field].ToDictionary(row => (string)row["address"], row => (JObject)row.DeepClone(), StringComparer.Ordinal);
            before = Rows("before"); after = Rows("after"); er = Rows("erAccounts");
            ownerSeed = Convert.FromBase64String((string)inputs["ownerSeed"]); candidateSeed = Convert.FromBase64String((string)inputs["candidateSeed"]);
            if (scenario["active"].Type == JTokenType.Object) active = Convert.FromBase64String((string)inputs["deviceSeed"]);
            using var signer = new DeviceSigner(ownerSeed);
            if (signer.Address != Owner) throw new FormatException("Synthetic owner seed does not match fixture identity");
            now = (long)inputs["now"]; Clock = () => { lock (gate) return now; };
        }
        public void AdvanceClock(long seconds)
        { if (seconds <= 0) throw new ArgumentOutOfRangeException(nameof(seconds)); lock (gate) now = checked(now + seconds); }
        public MoneyEvidenceDelay HoldNextWallet()
        {
            lock (gate)
            {
                if (walletHold != null || signed) throw new InvalidOperationException("The finite signing hold is unavailable");
                return walletHold = new MoneyEvidenceDelay();
            }
        }
        public MoneyEvidenceDelay HoldNextRead(string method)
        {
            if (method != "getAccountInfo" && method != "getMultipleAccounts" && method != "getSignatureStatuses") throw new ArgumentException("Unknown finite session read", nameof(method));
            lock (gate)
            {
                if (readHold != null) throw new InvalidOperationException("A session read is already held");
                heldMethod = method; return readHold = new MoneyEvidenceDelay();
            }
        }
        public void FailFirstReadAfterJournalClear() => ArmReadback(false);
        public void CorruptFirstReadAfterJournalClear(string account = null) => ArmReadback(true, account: account);
        public void TimeoutFirstReadAfterJournalClear() => ArmReadback(false, true);
        public void RejectClaimPeerReads()
        {
            lock (gate)
            {
                if (Operation != "claim" || sent) throw new InvalidOperationException("Peer read fault requires an unsubmitted claim fixture");
                rejectClaimPeerReads = true;
            }
        }
        private void ArmReadback(bool corrupt, bool timeout = false, string account = null)
        {
            lock (gate)
            {
                if (sent || readbackFaultArmed) throw new InvalidOperationException("The finite post-confirmation fault must be armed once before submission");
                if (account != null)
                {
                    SolanaAddress.Bytes(account);
                    if (!before.ContainsKey(account) && !after.ContainsKey(account))
                        throw new ArgumentException("The corruption target must be a declared fixture account", nameof(account));
                }
                corruptReadbackTarget = account;
                failReadback = true; corruptReadback = corrupt; timeoutReadback = timeout; readbackFaultArmed = true;
            }
        }
        public void ConfirmPendingSuccess() => Advance(false);
        public void ConfirmPendingFailure() => Advance(true);
        private void Advance(bool failure)
        {
            lock (gate)
            {
                if (!sent || !pendingObserved || advanced || (string)scenario["status"] != "processed" || Failure != failure)
                    throw new InvalidOperationException("This scenario has no matching observed pending outcome");
                advanced = true; Record("synthetic-ledger", failure ? "confirm-failure" : "confirm-success");
            }
        }
        private void Record(string boundary, string operation) { lock (gate) calls.Add(new MoneyEvidenceCall(boundary, operation)); }
        private Exception Forbidden(string boundary, string operation)
        { lock (gate) { forbidden++; Record(boundary, "forbidden-" + operation); } return new InvalidOperationException("Synthetic session evidence forbids " + operation); }
        private void OwnerOnly(string owner) { if (owner != Owner) throw Forbidden("synthetic-native", "another-owner"); }
        private void Exact(string field, string value)
        {
            if (scenario["transaction"]?.Type != JTokenType.Object || value != (string)scenario["transaction"][field])
                throw Forbidden("synthetic-boundary", "unrecognized-" + field);
        }
        private JObject Context(JToken value) => new JObject { ["context"] = inputs["accountContext"].DeepClone(), ["value"] = value };
        private JToken Account(string address, bool resolvedEr)
        {
            SolanaAddress.Bytes(address);
            lock (gate)
            {
                var rows = resolvedEr ? er : Accepted ? after : before;
                if (!rows.TryGetValue(address, out var row)) return JValue.CreateNull();
                return new JObject { ["owner"] = row["owner"], ["executable"] = row["executable"], ["lamports"] = row["lamports"] ?? inputs["accountLamports"],
                    ["data"] = new JArray(row["data"], "base64") };
            }
        }
        private sealed class Http : IJsonRpcHttp
        {
            private readonly MoneySessionEvidenceGraph graph;
            public Http(MoneySessionEvidenceGraph graph) { this.graph = graph; }
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested(); var request = JObject.Parse(json);
                string method = (string)request["method"], route = endpoint.AbsoluteUri;
                bool baseLayer = route == (string)graph.inputs["base"], router = route == (string)graph.inputs["router"], resolvedEr = route == (string)graph.inputs["er"];
                if (!baseLayer && !router && !resolvedEr) throw graph.Forbidden("synthetic-rpc", "endpoint");
                graph.Record(baseLayer ? "synthetic-base" : router ? "synthetic-router" : "synthetic-er", method);
                MoneyEvidenceDelay hold = null;
                lock (graph.gate) if (graph.heldMethod == method) { hold = graph.readHold; graph.readHold = null; graph.heldMethod = null; }
                if (hold != null) await hold.Wait().ConfigureAwait(false);
                // Deliberately permits a late callback. Real transport/Flow owns
                // cancellation and owner-generation rejection after this await.
                JToken result;
                switch (method)
                {
                    case "getGenesisHash" when baseLayer: result = graph.inputs["expectedGenesis"].DeepClone(); break;
                    case "getAccountInfo" when !router:
                    case "getMultipleAccounts" when !router:
                        bool single = method == "getAccountInfo";
                        var addresses = single ? new[] { (string)request["params"][0] } : request["params"][0].Values<string>().ToArray();
                        if (addresses.Length > SolanaRpcTransport.MaximumBatchAccounts) throw new FormatException("Unbounded synthetic account read");
                        if (graph.rejectClaimPeerReads && addresses.Contains(graph.Services.Planner.Board(graph.ClaimDay,
                            graph.ClaimKind == "score" ? "theme" : "score")))
                        {
                            graph.Record("synthetic-base", "injected-unavailable-peer-board");
                            throw new System.IO.IOException("Synthetic peer board is unavailable");
                        }
                        string target = graph.corruptReadbackTarget ??
                            (graph.scenario["expectedActive"] is JObject acceptedRecord ? (string)acceptedRecord["token"] : null);
                        bool corruptResponse = false;
                        bool checkReadback;
                        lock (graph.gate) checkReadback = baseLayer && graph.failReadback && graph.sent && graph.Confirmed &&
                            (!graph.corruptReadback || (target != null && addresses.Contains(target)));
                        if (checkReadback && await graph.Services.Journal.Load(graph.Owner).ConfigureAwait(false) == null)
                        {
                            lock (graph.gate)
                            {
                                if (graph.failReadback)
                                {
                                    graph.failReadback = false;
                                    corruptResponse = graph.corruptReadback;
                                    graph.Record("synthetic-base", corruptResponse ? (graph.corruptReadbackTarget == null ?
                                        "injected-token-owner-after-journal-clear" : "injected-account-owner-after-journal-clear") :
                                        graph.timeoutReadback ? "injected-readback-timeout-after-journal-clear" : "injected-readback-failure-after-journal-clear");
                                    if (graph.timeoutReadback) throw new TaskCanceledException("Synthetic HTTP request timed out after confirmed journal reconciliation");
                                    if (!corruptResponse) throw new System.IO.IOException("Synthetic account readback failed after confirmed journal reconciliation");
                                }
                            }
                        }
                        var values = new JArray(addresses.Select(address => graph.Account(address, resolvedEr)));
                        if (corruptResponse) ((JObject)values[Array.IndexOf(addresses, target)])["owner"] = graph.Owner;
                        result = graph.Context(single ? values[0] : values); break;
                    case "getDelegationStatus" when router:
                        result = graph.er.ContainsKey((string)request["params"][0]) ? graph.inputs["delegated"].DeepClone() : new JObject { ["isDelegated"] = false }; break;
                    case "getMinimumBalanceForRentExemption" when baseLayer:
                        if ((int)request["params"][0] != 0) throw graph.Forbidden("synthetic-rpc", "unknown-rent-size");
                        result = graph.inputs["rent"].DeepClone(); break;
                    case "getLatestBlockhash" when baseLayer:
                        if (graph.scenario["transaction"].Type != JTokenType.Object || graph.sent) throw graph.Forbidden("synthetic-rpc", "new-blockhash");
                        result = graph.inputs["blockhash"].DeepClone(); break;
                    case "getFeeForMessage" when baseLayer:
                        graph.Exact("message", (string)request["params"][0]); result = graph.inputs["fee"].DeepClone(); break;
                    case "getBalance" when baseLayer:
                        if ((string)request["params"][0] != graph.FeePayer || !graph.before.TryGetValue(graph.FeePayer, out var payer))
                            throw graph.Forbidden("synthetic-rpc", "another-payer");
                        result = graph.Context(payer["lamports"].DeepClone()); break;
                    case "simulateTransaction" when baseLayer:
                        string bytes = (string)request["params"][0];
                        // Device-only claims arrive locally signed at the first simulation.
                        // Keep exact-byte matching; this never grants owner signing.
                        graph.Exact(graph.signed || !graph.OwnerSignatureRequired ? "signed" : "partial", bytes);
                        if (!graph.OwnerSignatureRequired) lock (graph.gate) graph.signed = true;
                        result = graph.inputs["simulation"].DeepClone(); break;
                    case "sendTransaction" when baseLayer:
                        graph.Exact("signed", (string)request["params"][0]);
                        var pending = await graph.Services.Journal.Load(graph.Owner).ConfigureAwait(false);
                        if (pending == null || pending.Signature != graph.Signature || !pending.Transaction.SequenceEqual(Convert.FromBase64String((string)graph.scenario["transaction"]["signed"])))
                            throw graph.Forbidden("synthetic-rpc", "send-before-journal");
                        lock (graph.gate)
                        {
                            if (graph.sent || !graph.signed) throw graph.Forbidden("synthetic-rpc", "duplicate-or-unsigned-send");
                            graph.sent = true; result = new JValue(graph.Signature);
                        }
                        break;
                    case "getSignatureStatuses" when baseLayer:
                        lock (graph.gate)
                        {
                            if (!graph.sent || request["params"][0].Count() != 1 || (string)request["params"][0][0] != graph.Signature || (bool?)request["params"][1]?["searchTransactionHistory"] != true)
                                throw graph.Forbidden("synthetic-rpc", "unknown-status");
                            bool confirmed = graph.Confirmed; if (!confirmed) graph.pendingObserved = true;
                            var status = (JObject)graph.inputs["confirmedFailure"]["value"][0].DeepClone();
                            status["confirmationStatus"] = confirmed ? "confirmed" : "processed";
                            if (!graph.Failure) status["err"] = JValue.CreateNull();
                            graph.Record("synthetic-ledger", confirmed ? graph.Failure ? "observed-confirmed-failure" : "observed-confirmed-success" : "observed-processed");
                            result = graph.Context(new JArray { status });
                        }
                        break;
                    default: throw graph.Forbidden("synthetic-rpc", method);
                }
                string response = new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString(Newtonsoft.Json.Formatting.None);
                if (Encoding.UTF8.GetByteCount(response) > maximumResponseBytes) throw new FormatException("Synthetic RPC response exceeds bound");
                return response;
            }
        }
        private sealed class Native : INativeDeviceKeyLifecycle
        {
            private readonly MoneySessionEvidenceGraph graph;
            public Native(MoneySessionEvidenceGraph graph) { this.graph = graph; }
            public async Task<string> Request(string json)
            {
                var request = JObject.Parse(json); string operation = (string)request["operation"];
                string owner = Convert.ToBase64String(SolanaAddress.Bytes(graph.Owner));
                if (request["owner"] != null && (string)request["owner"] != owner) throw graph.Forbidden("synthetic-native", "another-owner");
                if (operation != "authorize" && operation != "disconnect" && operation != "signTransactions") throw graph.Forbidden("synthetic-native", operation);
                graph.Record("synthetic-native", operation);
                var response = new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = owner };
                if (operation == "signTransactions")
                {
                    if (!graph.OwnerSignatureRequired) throw graph.Forbidden("synthetic-native", "unexpected-owner-signing");
                    graph.Exact("partial", (string)request["transaction"]);
                    MoneyEvidenceDelay hold;
                    lock (graph.gate) { if (graph.signed) throw graph.Forbidden("synthetic-native", "another-signing"); hold = graph.walletHold; graph.walletHold = null; }
                    if (hold != null) await hold.Wait().ConfigureAwait(false);
                    if ((bool)graph.scenario["ownerDeclines"])
                    { response["ok"] = false; response["error"] = "wallet-rejected"; }
                    else
                    {
                        using var signer = new DeviceSigner(graph.ownerSeed);
                        string signed = Convert.ToBase64String(signer.PartialSign(Convert.FromBase64String((string)request["transaction"])));
                        graph.Exact("signed", signed); lock (graph.gate) graph.signed = true;
                        response["transaction"] = signed;
                    }
                }
                return response.ToString(Newtonsoft.Json.Formatting.None);
            }
            public Task<byte[]> LoadDeviceSeed(string owner)
            { graph.OwnerOnly(owner); graph.Record("synthetic-native", "load-device"); lock (graph.gate) return Task.FromResult(graph.active?.ToArray()); }
            public Task<byte[]> LoadCandidateSeed(string owner)
            { graph.OwnerOnly(owner); graph.Record("synthetic-native", "load-candidate"); lock (graph.gate) return Task.FromResult(graph.candidate?.ToArray()); }
            public Task<byte[]> CreateDeviceSeed(string owner) => throw graph.Forbidden("synthetic-native", "create-active-directly");
            public Task<byte[]> CreateCandidateSeed(string owner)
            {
                graph.OwnerOnly(owner); lock (graph.gate)
                {
                    if ((string)graph.scenario["operation"] != "enable" || graph.sent) throw graph.Forbidden("synthetic-native", "unexpected-candidate");
                    graph.Record("synthetic-native", "create-candidate"); graph.candidate ??= graph.candidateSeed.ToArray(); return Task.FromResult(graph.candidate.ToArray());
                }
            }
            public Task RemoveDeviceSeed(string owner)
            {
                graph.OwnerOnly(owner); lock (graph.gate)
                {
                    if (graph.sent && !graph.Confirmed) throw graph.Forbidden("synthetic-native", "unconfirmed-deletion");
                    graph.Record("synthetic-native", graph.active == null ? "remove-absent-device" : "remove-device"); graph.active = null;
                }
                return Task.CompletedTask;
            }
            public Task PromoteCandidateSeed(string owner, byte[] expectedActive, byte[] expectedCandidate)
            {
                graph.OwnerOnly(owner); lock (graph.gate)
                {
                    bool Match(byte[] seed, byte[] digest) { if (seed == null || digest == null) return seed == null && digest == null; using var hash = SHA256.Create(); return hash.ComputeHash(seed).SequenceEqual(digest); }
                    if (!graph.Accepted) throw graph.Forbidden("synthetic-native", "unconfirmed-promotion");
                    if (graph.candidate == null && Match(graph.active, expectedCandidate)) return Task.CompletedTask;
                    if (!Match(graph.active, expectedActive) || !Match(graph.candidate, expectedCandidate)) throw new InvalidOperationException("Synthetic key snapshot changed");
                    graph.active = graph.candidate; graph.candidate = null; graph.Record("synthetic-native", "promote-candidate"); return Task.CompletedTask;
                }
            }
        }
        private sealed class Memory : IPublicClientStore
        {
            private readonly MoneySessionEvidenceGraph graph;
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public Memory(MoneySessionEvidenceGraph graph) { this.graph = graph; }
            private void Check(string owner, string field)
            { graph.OwnerOnly(owner); if (field != "session" && field != "journal" && field != "campaign" && field != "daily") throw graph.Forbidden("synthetic-store", "unknown-field"); }
            public Task<string> Read(string owner, string field)
            { Check(owner, field); lock (values) { values.TryGetValue(field, out var value); return Task.FromResult(value); } }
            public Task Write(string owner, string field, string value) => throw graph.Forbidden("synthetic-store", "unguarded-write");
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                Check(owner, field); lock (values)
                {
                    values.TryGetValue(field, out var current); if (current != expected) return Task.FromResult(false);
                    values[field] = value; graph.Record("synthetic-store", (value == null ? "clear-" : "commit-") + field); return Task.FromResult(true);
                }
            }
        }
    }
}
#endif
