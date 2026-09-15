using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyCompositionTests
    {
        [Test]
        public async Task PublicReadUsesOnlyTheThreePublicPdasWithoutAnIdentityOrPlatformStorage()
        {
            var e = new MoneyTestEnvironment();
            Assert.That(e.Http.Requests, Is.Empty); Assert.That(e.Native.Calls, Is.Zero); Assert.That(e.Store.Calls, Is.Zero);
            var value = (await e.Flow.RefreshPublic()).Value;
            Assert.That(value.DayId, Is.EqualTo((uint)e.Plans["inputs"]["day"]));
            Assert.That(value.HasPublication, Is.True);
            var request = e.Http.Requests.Single(x => (string)x["method"] == "getMultipleAccounts");
            CollectionAssert.AreEqual(new[] { e.Services.Planner.ProtocolAddress, e.Services.Planner.ArcadeAddress,
                e.Services.Planner.Daily(value.DayId) }, request["params"][0].Values<string>());
            Assert.That(e.Native.Calls + e.Native.KeyLoads + e.Store.Calls, Is.Zero);
            await e.Flow.StopAsync();
        }
        [Test]
        public async Task ConfigurationIsExplicitAndWrongGenesisCannotInterpretAccounts()
        {
            var e = new MoneyTestEnvironment();
            foreach (var config in new[] { null, new MoneyConnectionConfig(null, e.Config.RouterUri, e.Config.ExpectedGenesis),
                new MoneyConnectionConfig(e.Config.BaseUri, e.Config.RouterUri, "mainnet"),
                new MoneyConnectionConfig(e.Config.BaseUri, e.Config.BaseUri, e.Config.ExpectedGenesis) })
                Assert.Throws<MoneyConfigurationException>(() => e.Create(config));
            Assert.That(e.Http.Requests, Is.Empty); Assert.That(e.Native.Calls + e.Store.Calls, Is.Zero);
            e.Http.Genesis = "wrong-genesis";
            await MoneyTestEnvironment.Fails<Exception>(async () => await e.Flow.RefreshPublic());
            Assert.That(e.Http.Requests.Select(x => (string)x["method"]), Is.EqualTo(new[] { "getGenesisHash" }));
            Assert.That(e.Flow.Public, Is.Null); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundPreservesArcadeWithoutDeviceKeysOrNewTransactions()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); await e.Flow.Connect(e.Owner);
            var value = (await e.Flow.RefreshOwner()).Value;
            foreach (var mode in new[] { "daily" })
            {
                var actual = value.Daily;
                var row = e.Runs["cases"].Single(x => (string)x["id"] == "active-" + mode + "-playing");
                Assert.That(actual.Phase, Is.EqualTo("delegated"));
                CollectionAssert.AreEqual(Convert.FromBase64String((string)row["token"]["state"]), actual.Token.State);
                Assert.That((await e.Services.RunMarkers.Load(e.Owner, mode)).ActiveRun, Is.EqualTo((string)row["address"]));
            }
            Assert.That(value.Session.Status, Is.EqualTo("none")); Assert.That(value.Pending, Is.Null);
            Assert.That(e.Native.Calls, Is.EqualTo(1)); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExplicitReadyEnsureDoesNotCreateKeysOrPromptAndOldPurchaseRemainsADistinctReceipt()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            var ready = (await e.Flow.EnsureSession()).Value;
            Assert.That(ready.Action, Is.EqualTo("ready")); Assert.That(ready.Ready, Is.True);
            Assert.That(ready.Operation.Outcome, Is.EqualTo(ExecutionOutcome.CompletedLocally));
            e.AddEconomy(); await e.Services.Journal.Begin(e.Purchase());
            var old = (await e.Flow.EnsureSession()).Value;
            Assert.That(old.Action, Is.EqualTo("recover")); Assert.That(old.Operation.Intent, Is.EqualTo("purchase-one"));
            Assert.That(old.Operation.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null);
            Assert.That(e.Native.Calls, Is.EqualTo(1)); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task PendingPurchaseUsesRealDispatcherAndInvalidatesRetainedEconomyProjection()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); e.AddEconomy(); await e.Flow.Connect(e.Owner);
            var retained = await e.Flow.RefreshOwner(); await e.Services.Journal.Begin(e.Purchase());
            var result = await e.Services.Executor.Resume(e.Owner, e.Services.Dispatcher);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That(retained.IsCurrent, Is.False); Assert.Throws<OperationCanceledException>(() => _ = retained.Value);
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundPendingStatusNeverBecomesAnEmptySuccessOrNewSessionRepair()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); e.Http.Confirmation = "processed";
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var value = (await e.Flow.RefreshOwner()).Value;
            Assert.That(value.PreviousOperation.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(value.Pending.Signature, Is.EqualTo(pending.Signature));
            Assert.That(value.Profile, Is.Null); Assert.That(value.Campaign, Is.Null); Assert.That(value.Session, Is.Null);
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Native.KeyLoads, Is.Zero); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundDoesNotConsumeATransactionArrivingDuringItsProfileRead()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); e.AddEconomy();
            // Let the independent connect-time record read enter before holding
            // the foreground read whose transaction boundary this case checks.
            e.Http.DelayMethod = "getAccountInfo";
            e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            await e.Flow.Connect(e.Owner); await e.Http.Entered.Task; e.Http.Release.SetResult(true);
            e.Http.DelayMethod = "getAccountInfo";
            e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var refresh = e.Flow.RefreshOwner(); await e.Http.Entered.Task;
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            e.Http.StatusError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            e.Http.Release.SetResult(true); var observed = (await refresh).Value;
            Assert.That(observed.PreviousOperation, Is.Null);
            Assert.That(observed.Pending.Signature, Is.EqualTo(pending.Signature));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Http.Requests.Any(x => (string)x["method"] == "getSignatureStatuses"), Is.False);
            var receipt = (await e.Flow.ResumePending()).Value;
            Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(receipt.Signature, Is.EqualTo(pending.Signature));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ConfirmedFailureRemainsFailureAndMalformedObservedAccountsKeepTheJournal()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); e.AddEconomy();
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var address = e.Services.Planner.CreditVaultAddress; var valid = e.Http.Accounts[address].DeepClone();
            e.Http.Accounts[address]["owner"] = e.Owner;
            var malformed = (await e.Flow.ResumePending()).Value;
            Assert.That(malformed.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            e.Http.Accounts[address] = valid;
            e.Http.StatusError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            var failed = (await e.Flow.ResumePending()).Value;
            Assert.That(failed.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(failed.ChainError, Is.Not.Null);
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExplicitUnderfundedEnsureKeepsTheSameSignerAndExposesFeeShortageBeforeSigning()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            e.Http.Accounts[(string)e.Plans["inputs"]["device"]]["lamports"] = 0;
            e.Http.AllowFeeQuote = true; e.Http.Blockhash = (string)e.Plans["inputs"]["blockhash"];
            var value = (await e.Flow.EnsureSession()).Value;
            Assert.That(value.Action, Is.EqualTo("refill")); Assert.That(value.Ready, Is.False);
            Assert.That(value.Operation.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage), value.Operation.Code);
            var quote = e.Http.Requests.Single(x => (string)x["method"] == "getFeeForMessage");
            var oracle = e.Plans["plans"].Single(x => (string)x["id"] == "session-refill-0");
            Assert.That((string)quote["params"][0], Is.EqualTo((string)oracle["expected"]["message"]));
            Assert.That((await e.Services.Sessions.Load(e.Owner)).Active.Signer, Is.EqualTo((string)e.Plans["inputs"]["device"]));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); Assert.That(e.Native.Calls, Is.EqualTo(1));
            Assert.That(e.Http.Requests.Any(x => (string)x["method"] == "sendTransaction"), Is.False); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ActualConsumedArcadeReceiptClearsItsDurableMarkerThroughTheComposedDispatcher()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); await e.Flow.Connect(e.Owner); await e.Flow.RefreshOwner();
            var campaign = await e.Services.RunMarkers.Load(e.Owner, "daily");
            e.Http.Accounts.Remove(campaign.ActiveRun); e.Http.Delegated.Remove(campaign.ActiveRun); e.Http.Add(e.Runs["consumedPlayers"]["daily"]);
            await e.Services.Journal.Begin(new PendingTransaction(e.Owner, "consume-daily", e.Config.BaseUri, true,
                Convert.FromBase64String((string)e.Runs["ownerConsume"]["daily"]), (string)e.Plans["inputs"]["blockhash"], 500));
            var result = (await e.Flow.ResumePending()).Value;
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That(await e.Services.RunMarkers.Load(e.Owner, "daily"), Is.Null);
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExistingSignedRenewalRunsDurableHandoffExactlyOnceAcrossGraphRestart()
        {
            var e = new MoneyTestEnvironment(); var fixture = MoneyTestEnvironment.Fixture("unity-session-plans-v1.json");
            var plan = fixture["cases"][0]; e.Native.Seed = Enumerable.Repeat((byte)2, 32).ToArray(); e.Native.Candidate = Enumerable.Repeat((byte)3, 32).ToArray();
            var old = new SessionRecord(e.Owner, (string)fixture["inputs"]["previous"], (string)plan["oldToken"]["address"], e.Now + (long)plan["remaining"]);
            var candidate = new SessionRecord(e.Owner, (string)fixture["inputs"]["candidate"], (string)fixture["candidateToken"]["address"], (long)fixture["candidateToken"]["validUntil"]);
            await e.Services.Sessions.Replace(await e.Services.Sessions.Load(e.Owner), new SessionRecords(e.Owner, old, candidate));
            e.Http.Add(fixture["candidateToken"]); e.Http.Add(e.Solana["accounts"].Single(x => (string)x["id"] == "player-valid"));
            var pending = new PendingTransaction(e.Owner, "session-renew", e.Config.BaseUri, true, Convert.FromBase64String((string)plan["signedTransaction"]), (string)fixture["inputs"]["blockhash"], 500);
            await e.Services.Journal.Begin(pending); await e.Flow.StopAsync();
            var restarted = e.Create(e.Config); var flow = new MoneyAppFlow(restarted); await flow.Connect(e.Owner);
            var result = (await flow.ResumePending()).Value;
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That((await restarted.Sessions.Load(e.Owner)).Active.Signer, Is.EqualTo(candidate.Signer));
            Assert.That(e.Native.Promotions, Is.EqualTo(1)); Assert.That(await restarted.Journal.Load(e.Owner), Is.Null);
            Assert.That((await flow.ResumePending()).Value.Code, Is.EqualTo("no-pending-transaction"));
            Assert.That(e.Native.Promotions, Is.EqualTo(1)); e.AssertReadOnly(); await flow.StopAsync();
        }
    }

    // Transport/native/storage are deterministic injected test doubles. Signed
    // bytes and account data come from actual TypeScript fixture producers.
    internal sealed class MoneyTestEnvironment
    {
        internal static JObject Fixture(string name) => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/" + name))));
        internal static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"], (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        internal readonly JObject Plans = Fixture("unity-plans-v1.json"), Solana = Fixture("unity-solana-v1.json"), Runs = Fixture("unity-run-client-v1.json");
        internal readonly MemoryStore Store = new MemoryStore(); internal readonly FakeNative Native = new FakeNative(); internal readonly FakeHttp Http = new FakeHttp();
        internal MoneyConnectionConfig Config; internal MoneyClientServices Services; internal MoneyAppFlow Flow;
        internal long Now; internal string Owner => (string)Plans["inputs"]["owner"];
        internal MoneyTestEnvironment()
        {
            var rpc = Fixture("unity-rpc-v1.json"); Config = new MoneyConnectionConfig((string)rpc["inputs"]["base"], (string)rpc["inputs"]["router"], (string)rpc["inputs"]["expectedGenesis"]);
            Http.Genesis = Config.ExpectedGenesis; Http.Er = (string)rpc["inputs"]["er"]; Http.Program = (string)rpc["inputs"]["program"]; Http.Validator = (string)Plans["inputs"]["validator"];
            Now = (long)Plans["inputs"]["now"]; Native.Owner = Owner; Services = Create(Config); Flow = new MoneyAppFlow(Services);
            var publications = Fixture("unity-product-reads-v1.json");
            foreach (var name in new[] { "protocol", "arcade", "daily" }) Http.Add(publications["accounts"][name]);
        }
        internal MoneyClientServices Create(MoneyConnectionConfig config) => new MoneyClientServices(
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")), config, Http, Native, Store, () => Now, owner => new ZKube.Local.LocalProductStore(owner: owner));
        internal void UseDailyRun()
        {
            Http.Add(Runs["player"]);
            foreach (var mode in new[] { "daily" })
            { var row = Runs["cases"].Single(x => (string)x["id"] == "active-" + mode + "-playing"); Http.Add(row); Http.Delegated.Add((string)row["address"]); }
        }
        internal void AddEconomy()
        { foreach (var name in new[] { "protocol", "arcade", "credit" }) Http.Add(Plans["accounts"][name]);
            Http.Add(Fixture("unity-economy-v1.json")["revenue"]); if (!Http.Accounts.ContainsKey(Services.Planner.Player(Owner))) Http.Add(Solana["accounts"].Single(x => (string)x["id"] == "player-valid")); }
        internal PendingTransaction Purchase() => new PendingTransaction(Owner, "purchase-one", Config.BaseUri, true,
            Convert.FromBase64String((string)Solana["transactions"].Single(x => (string)x["id"] == "purchase-1")["signedTransaction"]), (string)Solana["inputs"]["blockhash"], 500);
        internal async Task ReadySession()
        {
            Native.Seed = Enumerable.Repeat((byte)2, 32).ToArray(); var row = Plans["accounts"]["session"]; var token = Services.Tokens.Decode(Envelope(row));
            await Services.Sessions.Replace(await Services.Sessions.Load(Owner), new SessionRecords(Owner,
                new SessionRecord(Owner, (string)Plans["inputs"]["device"], (string)row["address"], token.ValidUntil), null));
            Http.Add(row); Http.Add(new JObject { ["address"] = Plans["inputs"]["device"], ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["lamports"] = 5000000, ["data"] = "" });
        }
        internal void AssertReadOnly() => Assert.That(Http.Requests.Any(x => new[] { "sendTransaction", "simulateTransaction", "getLatestBlockhash" }.Contains((string)x["method"])), Is.False);
        internal static async Task<T> Fails<T>(Func<Task> call) where T : Exception
        { try { await call(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }
        internal sealed class MemoryStore : IPublicClientStore, IDisposable
        {
            private readonly Dictionary<string, string> values = new Dictionary<string, string>(); internal int Calls; internal bool Disposed;
            public Task<string> Read(string owner, string field) { lock (values) { Calls++; values.TryGetValue(owner + field, out var value); return Task.FromResult(value); } }
            public Task Write(string owner, string field, string value) { lock (values) { Calls++; values[owner + field] = value; } return Task.CompletedTask; }
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            { lock (values) { Calls++; values.TryGetValue(owner + field, out var prior); if (prior != expected) return Task.FromResult(false); values[owner + field] = value; return Task.FromResult(true); } }
            public void Dispose() { Disposed = true; }
        }
        internal sealed class FakeNative : INativeDeviceKeyLifecycle, IDisposable
        {
            internal string Owner; internal int Calls, KeyLoads, Promotions, Deletions; internal byte[] Seed, Candidate; internal bool Disposed;
            internal TaskCompletionSource<bool> Entered, Release;
            public async Task<string> Request(string json)
            {
                Calls++; var request = JObject.Parse(json); string operation = (string)request["operation"];
                if (operation == "signTransactions") throw new InvalidOperationException("No signing is allowed in this foreground fixture");
                if (operation == "authorize") { Entered?.TrySetResult(true); if (Release != null) await Release.Task; }
                return new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = request["owner"]?.Type == JTokenType.String ? request["owner"] : new JValue(Owner) }.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(string owner) { KeyLoads++; return Task.FromResult(Seed?.ToArray()); }
            public Task<byte[]> LoadCandidateSeed(string owner) => Task.FromResult(Candidate?.ToArray());
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new InvalidOperationException("Unexpected key creation");
            public Task<byte[]> CreateCandidateSeed(string owner) => throw new InvalidOperationException("Unexpected candidate creation");
            public Task RemoveDeviceSeed(string owner) { Deletions++; Seed = null; return Task.CompletedTask; }
            public Task PromoteCandidateSeed(string owner, byte[] oldHash, byte[] nextHash)
            {
                bool Match(byte[] seed, byte[] hash) { if (seed == null || hash == null) return seed == null && hash == null; using var sha = SHA256.Create(); return sha.ComputeHash(seed).SequenceEqual(hash); }
                if (Candidate == null && Match(Seed, nextHash)) return Task.CompletedTask;
                if (!Match(Seed, oldHash) || !Match(Candidate, nextHash)) throw new InvalidOperationException("Changed key snapshot");
                Seed = Candidate; Candidate = null; Promotions++; return Task.CompletedTask;
            }
            public void Dispose() { Disposed = true; }
        }
        internal sealed class FakeHttp : IJsonRpcHttp, IDisposable
        {
            internal readonly List<JObject> Requests = new List<JObject>(); internal readonly Dictionary<string, JToken> Accounts = new Dictionary<string, JToken>();
            internal readonly HashSet<string> Delegated = new HashSet<string>();
            internal string Genesis, Er, Program, Validator, Confirmation = "confirmed", DelayMethod, Blockhash;
            internal bool AllowFeeQuote;
            internal JToken StatusError;
            internal bool ThrowOnCancellation;
            internal int CancellationCallbacks;
            internal TaskCompletionSource<bool> Entered, Release; internal bool Disposed;
            internal void Add(JToken row) => Accounts[(string)row["address"]] = row.DeepClone();
            public async Task<string> Post(Uri endpoint, string json, int maximum, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested(); var request = JObject.Parse(json); string method = (string)request["method"];
                request["endpoint"] = endpoint.AbsoluteUri; Requests.Add(request);
                using var registration = method == DelayMethod && ThrowOnCancellation ? cancellation.Register(() => {
                    Interlocked.Increment(ref CancellationCallbacks);
                    throw new InvalidOperationException("Injected cancellation callback: " + method);
                }) : default;
                if (method == DelayMethod) {
                    var release = Release; var entered = Entered; DelayMethod = null;
                    entered?.TrySetResult(true); if (release != null) await release.Task;
                }
                // Deliberately allow this fake callback to arrive after cancellation;
                // the real transport/flow must still reject publication.
                JToken Account(string address) => Accounts.TryGetValue(address, out var row) ? new JObject {
                    ["owner"] = row["owner"], ["executable"] = row["executable"], ["lamports"] = row["lamports"] ?? new JValue(5000000), ["data"] = new JArray(row["data"], "base64") } : JValue.CreateNull();
                JObject Context(JToken value) => new JObject { ["context"] = new JObject { ["slot"] = 1000 }, ["value"] = value };
                JToken result;
                switch (method)
                {
                    case "getGenesisHash": result = new JValue(Genesis); break;
                    case "getMultipleAccounts": result = Context(new JArray(request["params"][0].Values<string>().Select(Account))); break;
                    case "getAccountInfo": result = Context(Account((string)request["params"][0])); break;
                    case "getSignatureStatuses": result = Context(new JArray { Confirmation == null ? JValue.CreateNull() : new JObject { ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() } }); break;
                    case "getBlockHeight": result = new JValue(400); break;
                    case "getMinimumBalanceForRentExemption": result = new JValue(890880); break;
                    case "getLatestBlockhash" when AllowFeeQuote: result = Context(new JObject { ["blockhash"] = Blockhash, ["lastValidBlockHeight"] = 500 }); break;
                    case "getFeeForMessage" when AllowFeeQuote: result = Context(new JValue(5400)); break;
                    case "getBalance" when AllowFeeQuote: result = Context(new JValue(0)); break;
                    case "getDelegationStatus": result = Delegated.Contains((string)request["params"][0]) ? new JObject { ["isDelegated"] = true, ["fqdn"] = Er,
                        ["delegationRecord"] = new JObject { ["owner"] = Program, ["authority"] = Validator, ["delegationSlot"] = 900, ["lamports"] = 1 } } : new JObject { ["isDelegated"] = false }; break;
                    default: throw new InvalidOperationException("Unplanned offline RPC " + method);
                }
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
            }
            public void Dispose() { Disposed = true; }
        }
    }
}
