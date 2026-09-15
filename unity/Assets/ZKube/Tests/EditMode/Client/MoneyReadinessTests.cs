using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;
using ZKube.Integration.Client;
using ZKube.Integration.Tests;

namespace ZKube.Integration.Execution.Tests
{
    public sealed class MoneyReadinessTests
    {
        private JObject solana, plans, rpcFixture;
        private string owner, device;
        private TransactionPlanner planner;
        private AccountBindings accounts;
        private SessionTokenBindings sessions;
        private Store store;
        private Http http;
        private Wallet native;
        private Observer observer;
        private TransactionExecutor executor;
        private ConcurrentQueue<string> events;
        private static JObject Fixture(string name) => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/" + name))));
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        [SetUp]
        public void Setup()
        {
            solana = Fixture("unity-solana-v1.json"); plans = Fixture("unity-plans-v1.json"); rpcFixture = Fixture("unity-rpc-v1.json");
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idl = File.ReadAllText(Path.Combine(generated, "solana.json"));
            var protocol = new ProtocolBindings(idl);
            accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            sessions = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            planner = new TransactionPlanner(protocol, sessions);
            owner = (string)solana["inputs"]["owner"]; device = (string)solana["inputs"]["device"];
            events = new ConcurrentQueue<string>(); store = new Store(events); native = new Wallet(events);
            http = new Http(events, store, rpcFixture, solana, plans, owner);
            observer = new Observer(accounts, planner);
            executor = NewExecutor();
        }
        private TransactionExecutor NewExecutor() => new TransactionExecutor(planner,
            new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"],
                (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId), new WalletClient(native), new TransactionJournal(store));
        private PendingTransaction SignedPurchase() => new PendingTransaction(owner, "purchase-one", (string)rpcFixture["inputs"]["base"], true,
            Convert.FromBase64String((string)solana["transactions"].Single(row => (string)row["id"] == "purchase-1")["signedTransaction"]),
            (string)solana["inputs"]["blockhash"], 500);


        private sealed class Prepared
        {
            public ClientIdentity Identity;
            public SessionLifecycle Lifecycle;
            public SessionRecordStore Records;
            public SolanaRpcTransport Rpc;
            public TransactionJournal Journal;
            public SessionInstructionReconciler Renewal;
            public SessionMaintenanceReconciler Maintenance;
            public IExecutionReconciler Dispatcher;
            public long Now;
        }
        private async Task<Prepared> Prepare(JToken row = null)
        {
            var fixture = Fixture("unity-money-readiness-v1.json");
            var value = new Prepared { Now = (long)fixture["inputs"]["now"] };
            native.DeviceSeed = row == null || (bool)row["keyPresent"] ? Enumerable.Repeat((byte)2, 32).ToArray() : null;
            var wallet = new WalletClient(native); value.Identity = new ClientIdentity(wallet); await value.Identity.Connect(owner);
            value.Records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = row?["token"] ?? plans["accounts"]["session"];
            var token = sessions.Decode(Envelope(tokenRow));
            if (row == null || (bool)row["keyPresent"])
                await value.Records.Replace(await value.Records.Load(owner), new SessionRecords(owner,
                    new SessionRecord(owner, device, (string)tokenRow["address"], token.ValidUntil), null));
            http.ExtraAccounts[(string)tokenRow["address"]] = row == null || (bool)row["tokenPresent"] ? tokenRow : JValue.CreateNull();
            http.ExtraAccounts[device] = row == null || (bool)row["signerPresent"]
                ? new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false,
                    ["data"] = "", ["lamports"] = row?["balance"] ?? new JValue(5000000) } : JValue.CreateNull();
            value.Rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            value.Journal = new TransactionJournal(store);
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            var keys = new DeviceKeyLifecycle(native);
            value.Renewal = new SessionInstructionReconciler(protocol, accounts, sessions, value.Records, new SessionHandoff(value.Records, keys, sessions, accounts.ProgramId), planner);
            value.Maintenance = new SessionMaintenanceReconciler(wallet, value.Records);
            value.Dispatcher = new ExecutionDispatcher(value.Renewal, value.Maintenance, new EconomyInstructionReconciler(protocol, accounts, value.Rpc, _ => Task.CompletedTask), null);
            executor = new TransactionExecutor(planner, value.Rpc, wallet, value.Journal);
            value.Lifecycle = new SessionLifecycle(value.Identity, wallet, keys, value.Records, sessions, planner, value.Rpc, value.Journal, executor,
                value.Dispatcher, accounts.ProgramId, () => value.Now);
            http.AfterSend = () =>
            {
                if (store.Peek(owner, "journal") == null) throw new InvalidOperationException("Missing signed intent");
                // Read the exact instruction bytes to model only accepted synthetic
                // session writes; tests never infer success from a button click.
                bool renew = TransactionSignatures.Describe(http.Sent).Instructions.Any(ix => ix.ProgramId == sessions.ProgramId);
                if (renew)
                {
                    var renewal = Fixture("unity-session-plans-v1.json");
                    var fresh = (JObject)renewal["candidateToken"].DeepClone();
                    byte[] bytes = Convert.FromBase64String((string)fresh["data"]);
                    byte[] expiry = BitConverter.GetBytes(value.Now + PlanningConstants.SessionLifetimeSeconds);
                    Array.Copy(expiry, 0, bytes, 136, 8); fresh["data"] = Convert.ToBase64String(bytes);
                    http.ExtraAccounts[(string)fresh["address"]] = fresh;
                    http.ExtraAccounts[(string)renewal["inputs"]["candidate"]] = new JObject { ["address"] = renewal["inputs"]["candidate"],
                        ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
                    if (token.ValidUntil <= value.Now) http.ExtraAccounts[tokenRow["address"].ToString()] = JValue.CreateNull();
                    http.ExtraAccounts[device] = JValue.CreateNull();
                }
                else http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram,
                    ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            };
            return value;
        }

        [Test]
        public async Task EnsureMatchesActualTypeScriptInspectionDecisionAndProducesFreshReadyState()
        {
            foreach (var row in Fixture("unity-money-readiness-v1.json")["sessionCases"])
            {
                Setup(); var env = await Prepare(row); int walletCalls = native.Calls;
                var result = await env.Lifecycle.Ensure();
                Assert.That(result.Action, Is.EqualTo((string)row["action"]), (string)row["variant"]);
                Assert.That(result.Ready, Is.True, (string)row["variant"] + ": " + result.Operation.Code);
                Assert.That(http.Count("sendTransaction"), Is.EqualTo(result.Action == "ready" ? 0 : 1));
                Assert.That(native.Calls - walletCalls, Is.EqualTo(result.Action == "ready" ? 0 : 1));
                Assert.That(native.Promotions, Is.EqualTo(result.Action == "renew" ? 1 : 0));
                Assert.That(await env.Journal.Load(owner), Is.Null);
            }
        }

        [Test]
        public async Task EnsureRecoversExistingRenewalWithoutAnotherCandidateOrWalletPrompt()
        {
            var row = Fixture("unity-money-readiness-v1.json")["sessionCases"].Single(x => (string)x["variant"] == "expired");
            var env = await Prepare(row); http.Confirmation = "processed";
            var first = await env.Lifecycle.Ensure();
            Assert.That(first.Ready, Is.False); Assert.That(first.Operation.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            string signature = (await env.Journal.Load(owner)).Signature;
            int walletCalls = native.Calls;
            var stillPending = await env.Lifecycle.Ensure();
            Assert.That(stillPending.Action, Is.EqualTo("recover")); Assert.That(stillPending.Ready, Is.False);
            Assert.That(stillPending.Operation.Signature, Is.EqualTo(signature));
            http.Confirmation = "confirmed";
            var recovered = await env.Lifecycle.Ensure();
            Assert.That(recovered.Action, Is.EqualTo("recover")); Assert.That(recovered.Ready, Is.True);
            Assert.That(recovered.Operation.Signature, Is.EqualTo(signature));
            Assert.That(native.Calls, Is.EqualTo(walletCalls)); Assert.That(http.Count("sendTransaction"), Is.EqualTo(1));
            Assert.That(native.Promotions, Is.EqualTo(1)); Assert.That(await env.Journal.Load(owner), Is.Null);
        }

        [Test]
        public async Task EnsureRejectionAndConcurrencyNeverPublishReadyOrDuplicateRenewal()
        {
            var row = Fixture("unity-money-readiness-v1.json")["sessionCases"].Single(x => (string)x["variant"] == "expired");
            var env = await Prepare(row); native.Reject = true;
            var rejected = await env.Lifecycle.Ensure();
            Assert.That(rejected.Ready, Is.False); Assert.That(native.Promotions, Is.Zero);
            Assert.That(await env.Journal.Load(owner), Is.Null);
            native.Reject = false; native.SignEntered = new TaskCompletionSource<bool>(); native.SignRelease = new TaskCompletionSource<bool>();
            var first = env.Lifecycle.Ensure(); await native.SignEntered.Task;
            var second = env.Lifecycle.Ensure(); native.SignRelease.SetResult(true);
            var results = await Task.WhenAll(first, second);
            Assert.That(results.All(x => x.Ready), Is.True);
            Assert.That(results[1].Action, Is.EqualTo("ready"));
            Assert.That(http.Count("sendTransaction"), Is.EqualTo(1));
        }

        [Test]
        public async Task EnsureNeverCallsAPreviousPurchaseANewRenewalOrSignsImmediatelyAfterItsRecovery()
        {
            var row = Fixture("unity-money-readiness-v1.json")["sessionCases"].Single(x => (string)x["variant"] == "expired");
            var env = await Prepare(row);
            var wallet = new WalletClient(native);
            var lifecycle = new SessionLifecycle(env.Identity, wallet, new DeviceKeyLifecycle(native), env.Records, sessions,
                planner, env.Rpc, env.Journal, executor, observer, accounts.ProgramId, () => env.Now);
            var pending = SignedPurchase(); await env.Journal.Begin(pending);
            int walletCalls = native.Calls;
            var result = await lifecycle.Ensure();
            Assert.That(result.Action, Is.EqualTo("recover")); Assert.That(result.Ready, Is.False);
            Assert.That(result.Operation.Intent, Is.EqualTo("purchase-one"));
            Assert.That(result.Operation.Signature, Is.EqualTo(pending.Signature));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Calls, Is.EqualTo(walletCalls));
            Assert.That(native.Candidate, Is.Null); Assert.That(await env.Journal.Load(owner), Is.Null);
        }

        [Test]
        public async Task DailyReadinessCannotReturnReadyAcrossEntryFreezeRolloverOrIdentityChange()
        {
            var row = Fixture("unity-money-readiness-v1.json")["dailyCases"].Single(x => (string)x["variant"] == "ready");
            foreach (string change in new[] { "freeze", "day", "slot", "identity", "pending" })
            {
                Setup(); var env = await Prepare();
                foreach (var entry in ((JObject)row["rows"]).Properties())
                    if (entry.Value is JObject && entry.Value["address"] != null) http.ExtraAccounts[(string)entry.Value["address"]] = entry.Value;
                http.AbsentNonPlayer = true;
                var daily = accounts.ArenaDaily(Envelope(row["rows"]["daily"]), (uint)Fixture("unity-money-readiness-v1.json")["inputs"]["day"]);
                Task transition = null;
                http.AfterRent = () =>
                {
                    if (change == "freeze") env.Now = (long)daily["runs_close_at"];
                    if (change == "day") env.Now += 86400;
                    if (change == "slot") http.ExtraAccounts[(string)row["rows"]["player"]["address"]] =
                        Fixture("unity-money-readiness-v1.json")["dailyCases"].Single(x => (string)x["variant"] == "resume")["rows"]["player"];
                    if (change == "identity") transition = env.Identity.Disconnect();
                    if (change == "pending") transition = env.Journal.Begin(SignedPurchase());
                };
                var query = new DailyEntryReadinessQuery(env.Identity, env.Lifecycle, accounts, planner, env.Rpc, env.Journal, () => env.Now);
                if (change == "identity") await AsyncAssert.Throws<OperationCanceledException>(() => query.Read());
                else
                {
                    var result = (await query.Read()).Value;
                    Assert.That(result.Status, Is.EqualTo(change == "freeze" ? "frozen" : change == "slot" ? "resume" : "changed"));
                }
                if (transition != null) await transition;
                Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Candidate, Is.Null);
            }
        }

        [Test]
        public async Task DailyReadinessMatchesActualTypeScriptDependencyAndLifecycleHelpersWithoutSigning()
        {
            var fixture = Fixture("unity-money-readiness-v1.json");
            var expected = new Dictionary<string,string> { ["ready"] = "ready", ["missing-receiver"] = "missing-receiver",
                ["missing-vault"] = "missing-vault", ["zero-kredits"] = "needs-kredits", ["resume"] = "resume",
                ["occupied"] = "run-address-occupied", ["frozen"] = "frozen", ["before-open"] = "not-open", ["paused"] = "paused", ["suspended"] = "suspended" };
            foreach (var row in fixture["dailyCases"])
            {
                Setup(); var env = await Prepare(); env.Now = (long)row["now"];
                foreach (var entry in ((JObject)row["rows"]).Properties())
                    if (entry.Value is JObject && entry.Value["address"] != null)
                        http.ExtraAccounts[(string)entry.Value["address"]] = entry.Value;
                if ((string)row["variant"] == "missing-receiver") http.ExtraAccounts[(string)plans["accounts"]["following"]["address"]] = JValue.CreateNull();
                if ((string)row["variant"] == "missing-vault") http.ExtraAccounts[(string)plans["accounts"]["credit"]["address"]] = JValue.CreateNull();
                http.AbsentNonPlayer = true;
                var query = new DailyEntryReadinessQuery(env.Identity, env.Lifecycle, accounts, planner, env.Rpc, env.Journal, () => env.Now);
                int walletCalls = native.Calls;
                if ((string)row["variant"] == "wrong-vault-owner")
                    await AsyncAssert.Throws<FormatException>(() => query.Read());
                else
                {
                    var result = (await query.Read()).Value;
                    Assert.That(result.Status, Is.EqualTo(expected[(string)row["variant"]]), (string)row["variant"]);
                    if (result.Ready) { Assert.That((string)row["dependency"], Is.EqualTo("ready")); Assert.That((string)row["preparation"], Is.EqualTo("ready")); Assert.That((string)row["lifecycle"], Is.EqualTo("entries-open")); }
                    if (result.Status == "resume") Assert.That((string)row["lifecycle"], Is.EqualTo("resume"));
                }
                Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Calls, Is.EqualTo(walletCalls));
                Assert.That(native.Candidate, Is.Null); Assert.That(await env.Journal.Load(owner), Is.Null);
            }
        }

        private sealed class Store : IPublicClientStore
        {
            private readonly ConcurrentQueue<string> events;
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public Store(ConcurrentQueue<string> events) { this.events = events; }
            public string Peek(string owner, string field) { lock (values) return values.TryGetValue(owner + field, out var value) ? value : null; }
            public Task<string> Read(string owner, string field) => Task.FromResult(Peek(owner, field));
            public Task Write(string owner, string field, string value) { lock (values) values[owner + field] = value; return Task.CompletedTask; }
            public async Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                await Task.Yield();
                lock (values)
                {
                    if (Peek(owner, field) != expected) return false;
                    values[owner + field] = value; if (field == "journal" && value != null) events.Enqueue("journal"); return true;
                }
            }
        }
        private sealed class Wallet : INativeDeviceKeyLifecycle
        {
            private readonly ConcurrentQueue<string> events;
            public int Calls; public bool Reject;
            public byte[] DeviceSeed;
            public int Deletions;
            public byte[] Candidate;
            public int Promotions;
            public TaskCompletionSource<bool> SignEntered, SignRelease;
            public Wallet(ConcurrentQueue<string> events) { this.events = events; }
            public async Task<string> Request(string json)
            {
                await Task.Yield(); Calls++; events.Enqueue("wallet");
                var request = JObject.Parse(json);
                if ((string)request["operation"] != "signTransactions")
                    return new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = request["owner"] }.ToString();
                SignEntered?.TrySetResult(true); if (SignRelease != null) await SignRelease.Task;
                if (Reject) return new JObject { ["requestId"] = request["requestId"], ["ok"] = false, ["error"] = "wallet-rejected" }.ToString();
                Assert.That((string)request["operation"], Is.EqualTo("signTransactions"));
                using var syntheticOwner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
                return new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = request["owner"],
                    ["transaction"] = Convert.ToBase64String(syntheticOwner.PartialSign(Convert.FromBase64String((string)request["transaction"]))) }.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(string owner) => Task.FromResult(DeviceSeed?.ToArray());
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new InvalidOperationException("Unexpected key creation");
            public Task RemoveDeviceSeed(string owner) { Deletions++; DeviceSeed = null; return Task.CompletedTask; }
            public Task<byte[]> LoadCandidateSeed(string owner) => Task.FromResult(Candidate?.ToArray());
            public Task<byte[]> CreateCandidateSeed(string owner) { Candidate ??= Enumerable.Repeat((byte)3, 32).ToArray(); return Task.FromResult(Candidate.ToArray()); }
            public Task PromoteCandidateSeed(string owner, byte[] oldHash, byte[] nextHash)
            {
                bool Match(byte[] seed, byte[] hash) { if (seed == null || hash == null) return seed == null && hash == null;
                    using var sha = SHA256.Create(); return sha.ComputeHash(seed).SequenceEqual(hash); }
                if (Candidate == null && Match(DeviceSeed, nextHash)) return Task.CompletedTask;
                if (!Match(DeviceSeed, oldHash) || !Match(Candidate, nextHash)) throw new InvalidOperationException("Changed synthetic key snapshot");
                DeviceSeed = Candidate; Candidate = null; Promotions++; return Task.CompletedTask;
            }
        }
        private sealed class Observer : IExecutionReconciler
        {
            private readonly AccountBindings bindings;
            private readonly TransactionPlanner planner;
            public bool Ready = true; public int Count;
            public TaskCompletionSource<bool> Entered, Release;
            public Observer(AccountBindings bindings, TransactionPlanner planner) { this.bindings = bindings; this.planner = planner; }
            public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
            {
                await Task.Yield(); Count++;
                Entered?.TrySetResult(true);
                if (Release != null) await Release.Task;
                Assert.That(evidence.Transaction.Instructions.Any(ix => ix.ProgramId == bindings.ProgramId), Is.True);
                Assert.That(TransactionSignatures.ValidateFullySigned(evidence.Pending.Transaction), Is.EqualTo(evidence.Pending.Signature));
                Assert.That(evidence.Accounts.All(a => a.Observation.Slot >= evidence.MinimumSlot), Is.True);
                Assert.That(evidence.Accounts.Select(a => a.Address), Is.EquivalentTo(evidence.Transaction.Accounts.Where(a => a.Writable).Select(a => a.Address)));
                var player = evidence.Accounts.SingleOrDefault(a => a.Address == planner.Player(evidence.Pending.Owner));
                if (player != null) bindings.PlayerState(player.Observation.Envelope, evidence.Pending.Owner);
                foreach (var account in evidence.Accounts.Where(a => a != player && a.Observation.Envelope?.Owner == bindings.ProgramId))
                    RunPlanSnapshot.Decode(bindings, account.Observation.Envelope, evidence.Pending.Owner);
                return Ready;
            }
        }
        private sealed class Http : IJsonRpcHttp
        {
            private readonly ConcurrentQueue<string> events; private readonly Store store;
            private readonly JObject rpc, solana, plans; private readonly string owner;
            public readonly ConcurrentQueue<JObject> Requests = new ConcurrentQueue<JObject>();
            public string Confirmation = "confirmed"; public ulong AccountSlot = 1000, Height = 400;
            public ulong Fee = 5400, Balance = 1000000000, Rent = 890880;
            public bool ThrowAfterSend, AbsentNonPlayer;
            public JToken StatusError, SimulationError, SignedSimulationError;
            public byte[] Sent;
            public Action AfterSend;
            public Action AfterRent;
            public readonly Dictionary<string, JToken> ExtraAccounts = new Dictionary<string, JToken>();
            public Http(ConcurrentQueue<string> events, Store store, JObject rpc, JObject solana, JObject plans, string owner)
            { this.events = events; this.store = store; this.rpc = rpc; this.solana = solana; this.plans = plans; this.owner = owner; }
            public int Count(string method) => Requests.Count(request => (string)request["method"] == method);
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                await Task.Yield(); cancellation.ThrowIfCancellationRequested();
                var request = JObject.Parse(json); string method = (string)request["method"];
                request["endpoint"] = endpoint.AbsoluteUri; Requests.Enqueue(request); events.Enqueue(method);
                JToken result;
                switch (method)
                {
                    case "getGenesisHash": result = rpc["inputs"]["expectedGenesis"]; break;
                    case "getLatestBlockhash": result = Context(new JObject { ["blockhash"] = solana["inputs"]["blockhash"], ["lastValidBlockHeight"] = 500 }, 1000); break;
                    case "getFeeForMessage": result = Context(new JValue(Fee), 1000); break;
                    case "getBalance": result = Context(new JValue(Balance), 1000); break;
                    case "getMinimumBalanceForRentExemption": AfterRent?.Invoke(); result = new JValue(Rent); break;
                    case "simulateTransaction":
                        var simulationError = SimulationError;
                        if (Count("simulateTransaction") == 2 && SignedSimulationError != null)
                        {
                            TransactionSignatures.ValidateFullySigned(Convert.FromBase64String((string)request["params"][0]));
                            simulationError = SignedSimulationError;
                        }
                        result = Context(new JObject { ["err"] = simulationError?.DeepClone() ?? JValue.CreateNull(), ["logs"] = new JArray(), ["unitsConsumed"] = 100 }, 1000); break;
                    case "sendTransaction":
                        Assert.That(store.Peek(owner, "journal"), Is.Not.Null, "Send ran before durable commit");
                        Sent = Convert.FromBase64String((string)request["params"][0]);
                        string signature = TransactionSignatures.ValidateFullySigned(Sent);
                        AfterSend?.Invoke();
                        if (ThrowAfterSend) throw new IOException("Synthetic response loss after submission");
                        result = new JValue(signature); break;
                    case "getSignatureStatuses": result = Context(new JArray(Confirmation == null ? JValue.CreateNull() : new JObject {
                        ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() }), 1000); break;
                    case "getBlockHeight": result = new JValue(Height); break;
                    case "getMultipleAccounts":
                        var addresses = request["params"][0].Values<string>().ToArray();
                        Assert.That(addresses.Length, Is.LessThanOrEqualTo(SolanaRpcTransport.MaximumBatchAccounts));
                        result = Context(new JArray(addresses.Select(Account)), AccountSlot); break;
                    case "getAccountInfo": result = Context(Account((string)request["params"][0]), AccountSlot); break;
                    case "getDelegationStatus": result = new JObject { ["isDelegated"] = true, ["fqdn"] = rpc["inputs"]["er"],
                        ["delegationRecord"] = new JObject { ["owner"] = rpc["inputs"]["program"], ["authority"] = plans["inputs"]["validator"], ["delegationSlot"] = 900, ["lamports"] = 1 } }; break;
                    default: throw new InvalidOperationException("Unexpected offline RPC " + method);
                }
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result.DeepClone() }.ToString(Formatting.None);
            }
            private JToken Account(string address)
            {
                if (ExtraAccounts.TryGetValue(address, out var extra))
                    return extra.Type == JTokenType.Null ? JValue.CreateNull() : new JObject { ["owner"] = extra["owner"], ["executable"] = extra["executable"],
                        ["lamports"] = extra["lamports"] ?? new JValue(5000000), ["data"] = new JArray(extra["data"], "base64") };
                var profile = solana["accounts"].Single(row => (string)row["id"] == "player-valid");
                JToken source = address == (string)profile["address"] ? profile : address == (string)plans["runs"]["campaign"]["address"] ? plans["runs"]["campaign"] : null;
                if (source != null) return new JObject { ["owner"] = source["owner"], ["executable"] = source["executable"], ["lamports"] = 1,
                    ["data"] = new JArray(source["data"], "base64") };
                if (AbsentNonPlayer) return JValue.CreateNull();
                return new JObject { ["owner"] = "11111111111111111111111111111111", ["executable"] = false, ["lamports"] = 1, ["data"] = new JArray("", "base64") };
            }
            private static JObject Context(JToken value, ulong slot) => new JObject { ["context"] = new JObject { ["slot"] = slot }, ["value"] = value };
        }
    }
}
