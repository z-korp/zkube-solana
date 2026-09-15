using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution.Tests
{
    public sealed class RunReconciliationTests
    {
        private static readonly string Root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private readonly JObject fixture = JObject.Parse(File.ReadAllText(Path.Combine(Root, "fixtures/unity-run-reconciliation-v1.json")));
        private readonly ProtocolBindings protocol;
        private readonly AccountBindings accounts;
        private readonly TransactionPlanner planner;
        public RunReconciliationTests()
        {
            string idl = File.ReadAllText(Root + "/unity/Assets/ZKube/Integration/Generated/solana.json");
            protocol = new ProtocolBindings(idl); accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            planner = new TransactionPlanner(protocol, new SessionTokenBindings(File.ReadAllText(Root + "/unity/Assets/ZKube/Integration/Generated/session.json")));
        }
        private static T Make<T>(params object[] args) => (T)Activator.CreateInstance(typeof(T), BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public, null, args, null);
        private JToken Row(string mode, string state) => fixture["cases"].Single(value => (string)value["id"] == "active-" + mode + "-" + state);
        private static AccountEnvelope Envelope(JToken value) => new AccountEnvelope((string)value["address"], (string)value["owner"], (bool)value["executable"], Convert.FromBase64String((string)value["data"]));
        private ExecutionReconciliation Evidence(string mode, string action, string state, bool failed = false, ulong slot = 9000, bool absent = false, bool delegatedAccount = false, bool progressed = false)
        {
            var tx = fixture["transactions"].Single(value => (string)value["id"] == (action == "delegate" ? "delegate" : mode + "-" + action));
            bool isBase = action == "consume" || action.StartsWith("prepare", StringComparison.Ordinal) || action == "delegate";
            var pending = new PendingTransaction((string)tx["owner"], action, isBase ? "https://base.invalid/" : "https://er.invalid/", isBase,
                Convert.FromBase64String((string)tx["bytes"]), (string)tx["blockhash"], 10000);
            var active = Envelope(Row(mode, state));
            if (delegatedAccount) active = new AccountEnvelope(active.Address, PlanningConstants.DelegationProgram, false, active.Data);
            var rows = new List<AffectedAccountObservation> {
                Make<AffectedAccountObservation>((string)Row(mode, state)["address"], Make<RpcAccount>(slot, 1UL, absent ? null : active)) };
            if (isBase) rows.Add(Make<AffectedAccountObservation>((string)fixture["player"]["address"], Make<RpcAccount>(slot, 1UL,
                Envelope(progressed ? fixture["consumedPlayer"] : action.StartsWith("prepare", StringComparison.Ordinal) ? fixture["preparedPlayers"][mode] : fixture["player"]))));
            var status = Make<RpcSignatureStatus>(RpcConfirmation.Confirmed, (ulong?)9000UL, failed ? "{}" : null, 9000UL);
            return Make<ExecutionReconciliation>(pending, TransactionSignatures.Describe(pending.Transaction), 9000UL, rows.ToArray(), status, false);
        }
        private RunInstructionReconciler Reconciler(Http http, List<RunSemanticObservation> accepted) => new RunInstructionReconciler(protocol, accounts, planner,
            new SolanaRpcTransport(http, "https://base.invalid/", "https://router.invalid/", http.Genesis, protocol.ProgramId), value => { accepted.Add(value); return Task.CompletedTask; });

        [Test]
        public void NativeSnapshotsMatchActualTypeScriptObserverDecisions()
        {
            foreach (var row in fixture["cases"])
            {
                var token = new ActiveRunReconciler(accounts).Reconcile(Envelope(row), (string)row["expectedAuthority"]);
                Assert.That(token.Config, Is.EqualTo(Convert.FromBase64String((string)row["token"]["config"])));
                Assert.That(token.State, Is.EqualTo(Convert.FromBase64String((string)row["token"]["state"])));
                var summary = NativeEngine.Summary(token); var decoded = accounts.ActiveRun(Envelope(row), (string)row["expectedAuthority"]);
                foreach (var action in row["action"])
                {
                    Assert.That(RunObservation.HasAcceptedAction(summary, (uint)action["expected"]), Is.EqualTo((bool)action["accepted"]), (string)row["id"]);
                    Assert.That(RunObservation.IsAcceptedActionReady(summary, (uint)decoded["pending_vrf_counter"], (uint)action["expected"]), Is.EqualTo((bool)action["ready"]));
                }
                foreach (var vrf in row["vrf"])
                    Assert.That(RunObservation.HasResolvedVrf((uint)decoded["vrf_request_counter"], (uint)decoded["pending_vrf_counter"], (uint)vrf["counter"]), Is.EqualTo((bool)vrf["resolved"]));
            }
        }

        [Test]
        public async Task AcceptedRerollWaitsForItsOwnVrfWithoutReplayOrCounterLoss()
        {
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(new Http(), output);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "reroll", "playing"), default), Is.False);
                Assert.That(output, Is.Empty);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "reroll", "awaitingVrf"), default), Is.True);
                Assert.That(output.Last().Phase, Is.EqualTo(RunSemanticPhase.AwaitingRow)); Assert.That(output.Last().ActionAccepted, Is.True);
                Assert.That(NativeEngine.Summary(output.Last().Token).ActionCounter, Is.EqualTo(1));
                Assert.That(await reconciler.Reconcile(Evidence(mode, "reroll", "rerolled"), default), Is.True);
                Assert.That(output.Last().Phase, Is.EqualTo(RunSemanticPhase.Ready));
                var exposed = output.Last().Token; exposed.State[0] = 255;
                Assert.That(output.Last().Token.State[0], Is.EqualTo(1));
            }
        }

        [Test]
        public async Task RequestVrfAndFinishRequireAuthoritativeCountersAndTerminalState()
        {
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(new Http(), output);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "vrf", "prepared"), default), Is.False);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "vrf", "playing"), default), Is.True);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "finish", "playing"), default), Is.False);
                Assert.That(await reconciler.Reconcile(Evidence(mode, "finish", "finished"), default), Is.True);
                Assert.That(output.Last().Phase, Is.EqualTo(RunSemanticPhase.Terminal));
                Assert.That(await reconciler.Reconcile(Evidence(mode, "reroll", "playing", failed: true), default), Is.True);
                Assert.That(output.Last().ActionAccepted, Is.False);
            }
        }

        [Test]
        public async Task CommitRequiresTerminalBaseCopybackAndNeverUsesAnErSlotOnBase()
        {
            var http = new Http { Delegated = true, Base = Row("campaign", "finished") };
            var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(http, output);
            Assert.That(await reconciler.Reconcile(Evidence("campaign", "commit", "finished"), default), Is.False);
            http.Delegated = false; http.Base = Row("campaign", "playing");
            Assert.That(await reconciler.Reconcile(Evidence("campaign", "commit", "finished"), default), Is.False);
            http.Base = Row("campaign", "finished");
            Assert.That(await reconciler.Reconcile(Evidence("campaign", "commit", "finished"), default), Is.True);
            Assert.That(output.Single().Endpoint, Is.EqualTo("https://base.invalid/"));
            Assert.That(output.Single().ContextSlot, Is.EqualTo(50));
            Assert.That(http.Requests.Where(r => (string)r["method"] == "getAccountInfo").All(r => r["params"][1]["minContextSlot"] == null), Is.True);
        }

        [Test]
        public async Task ConsumptionPreservesAStillReservedSlotAndRejectsStaleAbsence()
        {
            var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(new Http { Delegated = false }, output);
            Assert.That(await reconciler.Reconcile(Evidence("daily", "consume", "finished", absent: true), default), Is.False);
            Assert.That(output, Is.Empty);
            Assert.That(await reconciler.Reconcile(Evidence("campaign", "consume", "finished", absent: true), default), Is.True);
            Assert.That(output.Single().Phase, Is.EqualTo(RunSemanticPhase.Consumed));
            try { await reconciler.Reconcile(Evidence("campaign", "consume", "finished", slot: 8999, absent: true), default); Assert.Fail("Expected stale evidence rejection"); }
            catch (FormatException) { }
        }

        [Test]
        public async Task PreparationAndDelegationWaitForTheMatchingNativeRunOnItsCurrentEr()
        {
            var prepared = new List<RunSemanticObservation>();
            Assert.That(await Reconciler(new Http { Delegated = false }, prepared).Reconcile(Evidence("campaign", "prepare", "prepared"), default), Is.True);
            Assert.That(prepared.Single().Phase, Is.EqualTo(RunSemanticPhase.Prepared));
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var http = new Http(); var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(http, output);
                var evidence = Evidence(mode, "prepare-delegate", "prepared", delegatedAccount: true);
                Assert.That(await reconciler.Reconcile(evidence, default), Is.False); Assert.That(output, Is.Empty);
                http.Er = Row(mode, "prepared");
                Assert.That(await reconciler.Reconcile(evidence, default), Is.True);
                Assert.That(output.Single().Mode, Is.EqualTo(mode)); Assert.That(output.Single().RunId, Is.EqualTo(9007199254740993UL));
                Assert.That(output.Single().ContextSlot, Is.EqualTo(7));
                Assert.That(http.Requests.Where(r => (string)r["method"] == "getMultipleAccounts").All(r => r["params"][1]["minContextSlot"] == null), Is.True);
            }
            var delegated = new List<RunSemanticObservation>();
            Assert.That(await Reconciler(new Http { Er = Row("campaign", "playing") }, delegated).Reconcile(
                Evidence("campaign", "delegate", "prepared", delegatedAccount: true), default), Is.True);
        }

        [Test]
        public async Task RelocatedErActionsBindCurrentNativeStateWithoutComparingLedgerSlots()
        {
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var http = new Http { Endpoint = "https://new-er.invalid/", Er = Row(mode, "playing") };
                var output = new List<RunSemanticObservation>(); var reconciler = Reconciler(http, output);
                var evidence = Evidence(mode, "reroll", "awaitingVrf");
                Assert.That(await reconciler.Reconcile(evidence, default), Is.False); Assert.That(output, Is.Empty);
                http.Er = Row(mode, "rerolled");
                Assert.That(await reconciler.Reconcile(evidence, default), Is.True);
                var routed = fixture["routing"].Single(r => (string)r["id"] == "active-" + mode + "-rerolled" && (bool)r["delegated"]);
                Assert.That((string)routed["phase"], Is.EqualTo("delegated"));
                Assert.That(output.Single().Endpoint, Is.EqualTo((string)routed["endpoint"])); Assert.That(output.Single().ContextSlot, Is.EqualTo(7));
                Assert.That(output.Single().Phase, Is.EqualTo(RunSemanticPhase.Ready));
                http.Delegated = false; http.Base = Row(mode, "finished"); output.Clear();
                Assert.That(await reconciler.Reconcile(evidence, default), Is.True);
                routed = fixture["routing"].Single(r => (string)r["id"] == "active-" + mode + "-finished" && !(bool)r["delegated"]);
                Assert.That((string)routed["phase"], Is.EqualTo("settleable"));
                Assert.That(output.Single().Phase, Is.EqualTo(RunSemanticPhase.Terminal)); Assert.That(output.Single().Endpoint, Is.EqualTo((string)routed["endpoint"]));
            }
        }

        [Test]
        public async Task AConfirmedRunAlreadyConsumedOnAnotherDeviceReleasesOnlyItsAddress()
        {
            foreach (string mode in new[] { "campaign", "daily" })
            {
                foreach (string action in new[] { "prepare-delegate", "reroll", "commit" })
                {
                    var http = new Http { Delegated = false, Player = fixture["consumedPlayer"] };
                    var output = new List<RunSemanticObservation>();
                    Assert.That(await Reconciler(http, output).Reconcile(Evidence(mode, action, "finished", absent: true, progressed: true), default), Is.True);
                    Assert.That(output.Single().Phase, Is.EqualTo(RunSemanticPhase.Consumed));
                    Assert.That(output.Single().Address, Is.EqualTo((string)Row(mode, "finished")["address"]));
                    Assert.That(output.Single().PlayerAfter, Is.Not.Null);
                    Assert.That(output.Single().Token, Is.Null);
                    if (action != "prepare-delegate") Assert.That(output.Single().Mode, Is.Null);
                }
            }
        }

        [Test]
        public async Task UnrecognizedSignedSideEffectsDoNotClearTheRunJournal()
        {
            var evidence = Evidence("campaign", "reroll", "rerolled");
            var extra = new SolanaInstruction(PlanningConstants.SystemProgram, Array.Empty<AccountMeta>(), new byte[] { 255 });
            var description = Make<TransactionDescription>(evidence.Transaction.Accounts.ToArray(),
                evidence.Transaction.Instructions.Concat(new[] { extra }).ToArray(), evidence.Transaction.VersionZero);
            var changed = Make<ExecutionReconciliation>(evidence.Pending, description, evidence.MinimumSlot,
                evidence.Accounts.ToArray(), evidence.Status, evidence.Expired);
            var output = new List<RunSemanticObservation>();
            Assert.That(await Reconciler(new Http(), output).Reconcile(changed, default), Is.False);
            Assert.That(output, Is.Empty);
        }

        private sealed class Http : IJsonRpcHttp
        {
            public string Genesis => (string)JObject.Parse(File.ReadAllText(Root + "/fixtures/unity-rpc-v1.json"))["inputs"]["expectedGenesis"];
            public bool Delegated = true; public JToken Base;
            public string Endpoint = "https://er.invalid/";
            public JToken Er;
            public JToken Player;
            public List<JObject> Requests = new List<JObject>();
            public Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                var request = JObject.Parse(json); Requests.Add(request); JToken result;
                switch ((string)request["method"])
                {
                    case "getGenesisHash": result = Genesis; break;
                    case "getDelegationStatus": result = new JObject { ["isDelegated"] = Delegated,
                        ["fqdn"] = Delegated ? Endpoint : null }; break;
                    case "getMultipleAccounts":
                        bool isBase = endpoint.Host == "base.invalid";
                        JToken RpcAccount(JToken row) => row == null ? JValue.CreateNull() : new JObject { ["owner"] = row["owner"], ["executable"] = false,
                            ["lamports"] = 1, ["data"] = new JArray((string)row["data"], "base64") };
                        var values = new JArray { RpcAccount(isBase ? Base : Er) };
                        if (isBase && ((JArray)request["params"][0]).Count == 2) values.Add(RpcAccount(Player));
                        result = new JObject { ["context"] = new JObject { ["slot"] = isBase ? 9001 : 7 }, ["value"] = values }; break;
                    case "getAccountInfo": result = new JObject { ["context"] = new JObject { ["slot"] = 50 },
                        ["value"] = Base == null ? JValue.CreateNull() : new JObject { ["owner"] = Base["owner"], ["executable"] = false,
                            ["lamports"] = 1, ["data"] = new JArray((string)Base["data"], "base64") } }; break;
                    default: throw new InvalidOperationException("Unexpected RPC " + request["method"]);
                }
                return Task.FromResult(new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString(Formatting.None));
            }
        }
    }
}
