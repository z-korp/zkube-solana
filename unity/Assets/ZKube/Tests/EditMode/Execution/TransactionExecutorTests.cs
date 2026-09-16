using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    public sealed class TransactionExecutorTests
    {
        private JObject solana, plans, rpcFixture;
        private string owner, device;
        private TransactionPlanner planner;
        private AccountBindings accounts;
        private SessionTokenBindings sessions;
        private TestMemory store;
        private Http http;
        private TestNative native;
        private TestReconciler observer;
        private TransactionExecutor executor;
        private ConcurrentQueue<string> events;
        private static JObject Fixture(string name) => ZKube.Integration.Tests.ProgramScenarios.Load(name);
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        [SetUp]
        public void Setup()
        {
            solana = Fixture("solana"); plans = Fixture("plans"); rpcFixture = Fixture("transport");
            var bootstrap = new TestBootstrap();
            accounts = bootstrap.Accounts; sessions = bootstrap.Tokens; planner = bootstrap.Planner;
            owner = (string)solana["inputs"]["owner"]; device = (string)solana["inputs"]["device"];
            events = new ConcurrentQueue<string>(); store = new TestMemory(events); native = new TestNative(events) { AllowSigning = true, AllowCreation = () => true };
            http = new Http(events, store, rpcFixture, solana, plans, owner);
            observer = new TestReconciler(accounts, planner);
            executor = NewExecutor();
        }
        private TransactionExecutor NewExecutor() => new TransactionExecutor(planner,
            new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"],
                (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId), new WalletClient(native), new TransactionJournal(store));
        private PendingTransaction SignedPurchase() => new PendingTransaction(owner, "purchase-one", (string)rpcFixture["inputs"]["base"], true,
            Convert.FromBase64String((string)solana["transactions"].Single(row => (string)row["id"] == "purchase-1")["signedTransaction"]),
            (string)solana["inputs"]["blockhash"], 500);

        [Test]
        public async Task ResumeRejectsAChangedJournalBeforeObservingOrClearingIt()
        {
            var pending = SignedPurchase(); var journal = new TransactionJournal(store);
            await journal.Begin(pending);
            var result = await executor.Resume(owner, observer, expectedSignature: "previous-journal-signature");
            Assert.That(result.Code, Is.EqualTo("pending-transaction-changed"));
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            Assert.That((await journal.Load(owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(http.Requests, Is.Empty); Assert.That(native.Calls, Is.Zero);
        }

        [Test]
        public async Task OwnerPurchaseUsesExactQuoteSimulationAndDurableCommitBeforeSend()
        {
            var result = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            ZKube.Integration.Tests.ProgramScenarios.Equivalent(http.Sent, SignedPurchase().Transaction);
            Assert.That(result.Signature, Is.EqualTo(TransactionSignatures.ValidateFullySigned(http.Sent)));
            var order = events.ToArray();
            Assert.That(Array.IndexOf(order, "simulateTransaction"), Is.LessThan(Array.IndexOf(order, "wallet")));
            Assert.That(Array.IndexOf(order, "wallet"), Is.LessThan(Array.IndexOf(order, "journal")));
            Assert.That(http.Count("simulateTransaction"), Is.EqualTo(1));
            Assert.That(Array.LastIndexOf(order, "simulateTransaction"), Is.LessThan(Array.IndexOf(order, "journal")));
            Assert.That(Array.IndexOf(order, "journal"), Is.LessThan(Array.IndexOf(order, "sendTransaction")));
            Assert.That(observer.Count, Is.EqualTo(1)); Assert.That(await store.Read(owner, "journal"), Is.Null);
            var expectedMessage = (string)solana["transactions"].Single(row => (string)row["id"] == "purchase-1")["message"];
            ZKube.Integration.Tests.ProgramScenarios.EquivalentMessages((string)http.Requests.Single(request => (string)request["method"] == "getFeeForMessage")["params"][0], expectedMessage);
        }

        [Test]
        public async Task RestartBeforeSendNeverSendsAndRequiresHistoryAfterExpiryAndFreshAbsentAccountEvidence()
        {
            var pending = SignedPurchase(); await new TransactionJournal(store).Begin(pending);
            http.Confirmation = null; http.Height = 400;
            var first = await NewExecutor().Resume(owner, observer);
            Assert.That(first.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            http.Height = 501; http.AbsentNonPlayer = true;
            var final = await NewExecutor().Resume(owner, new TestReconciler(accounts, planner));
            Assert.That(final.Outcome, Is.EqualTo(ExecutionOutcome.ExpiredReconciled));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Calls, Is.Zero);
            Assert.That(http.Count("getLatestBlockhash"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);
            var methods = events.ToArray(); int lastHeight = Array.LastIndexOf(methods, "getBlockHeight");
            Assert.That(Array.LastIndexOf(methods, "getSignatureStatuses"), Is.GreaterThan(lastHeight));
            Assert.That(http.Requests.Where(r => (string)r["method"] == "getSignatureStatuses").All(r => (bool)r["params"][1]["searchTransactionHistory"]), Is.True);
        }

        [Test]
        public async Task RestartAfterUncertainSendRejectsStaleReadsAndNeverRequotesResignsOrSendsAgain()
        {
            http.ThrowAfterSend = true; http.Confirmation = null;
            var pending = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(pending.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(await store.Read(owner, "journal"), Is.Not.Null);
            http.Confirmation = "confirmed"; http.AccountSlot = 999;
            var stale = await NewExecutor().Resume(owner, observer);
            Assert.That(stale.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(observer.Count, Is.Zero);
            http.AccountSlot = 1000;
            var result = await NewExecutor().Resume(owner, observer);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(http.Count("sendTransaction"), Is.EqualTo(1)); Assert.That(http.Count("getLatestBlockhash"), Is.EqualTo(1));
            Assert.That(native.Calls, Is.EqualTo(1)); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task ProcessedErrorsRemainPendingAndFinalizedErrorsReconcileBeforeClearing()
        {
            http.Confirmation = "processed"; http.StatusError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            var first = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(first.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(observer.Count, Is.Zero);
            http.Confirmation = "finalized"; observer.Ready = false;
            var unresolved = await executor.Resume(owner, observer);
            Assert.That(unresolved.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(await store.Read(owner, "journal"), Is.Not.Null);
            observer.Ready = true;
            var final = await executor.Resume(owner, observer);
            Assert.That(final.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(final.ChainError, Is.Not.Null);
            Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task RejectionAndFeeShortageNeverReachSigningOrSendingOrCreateAJournal()
        {
            http.Balance = 1;
            var fee = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(fee.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage)); Assert.That(native.Calls, Is.Zero);
            http.Balance = 1000000000; http.SimulationError = new JObject { ["InstructionError"] = new JArray(0, "InsufficientFunds") };
            var simulation = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(simulation.Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); Assert.That(native.Calls, Is.Zero);
            http.SimulationError = null; native.Reject = true;
            var rejected = await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(rejected.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task DeviceReserveIsEnforcedAndAnExistingJournalNeverExecutesANewIntent()
        {
            using var signer = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            var actor = PlannerActor.Device(owner, device, Envelope(plans["accounts"]["session"]), sessions, accounts.ProgramId, (long)plans["inputs"]["now"]);
            var delegated = planner.Delegate(actor, (ulong)plans["inputs"]["nextRunId"], (string)plans["inputs"]["validator"]);
            Assert.That(delegated.PostFeeReserveLamports, Is.GreaterThan(0));
            http.Balance = http.Rent + http.Fee;
            var shortage = await executor.Execute(delegated, "delegate", new[] { signer }, observer);
            Assert.That(shortage.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Calls, Is.Zero);
            var prior = SignedPurchase(); await new TransactionJournal(store).Begin(prior);
            var observed = await executor.Execute(planner.Purchase(owner, 25, (string)solana["inputs"]["validator"]), "purchase-twenty-five", Array.Empty<DeviceSigner>(), observer);
            Assert.That(observed.Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); Assert.That(observed.Code, Is.EqualTo("pending-transaction-exists"));
            Assert.That(observed.Intent, Is.EqualTo("purchase-twenty-five")); Assert.That(observer.Count, Is.Zero);
            Assert.That(await new TransactionJournal(store).Load(owner), Is.Not.Null);
            var recovered = await executor.Resume(owner, observer);
            Assert.That(recovered.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess)); Assert.That(recovered.Intent, Is.EqualTo(prior.Intent));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(native.Calls, Is.Zero);
        }

        [Test]
        public async Task RecoverySerializesWithBothRecoveryAndNewSubmission()
        {
            await new TransactionJournal(store).Begin(SignedPurchase());
            observer.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            observer.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var first = executor.Resume(owner, observer);
            await observer.Entered.Task;
            try
            {
                var second = await executor.Resume(owner, observer);
                var submission = await executor.Execute(planner.Purchase(owner, 25, (string)solana["inputs"]["validator"]), "purchase-twenty-five", Array.Empty<DeviceSigner>(), observer);
                Assert.That(second.Code, Is.EqualTo("execution-busy")); Assert.That(submission.Code, Is.EqualTo("execution-busy"));
                Assert.That(observer.Count, Is.EqualTo(1)); Assert.That(native.Calls, Is.Zero); Assert.That(http.Count("sendTransaction"), Is.Zero);
            }
            finally { observer.Release.TrySetResult(true); }
            Assert.That((await first).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
        }

        [Test]
        public async Task ErSessionUsesTheResolvedEndpointAndNeverLaunchesTheOwnerWallet()
        {
            using var signer = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            var actor = PlannerActor.Device(owner, device, Envelope(plans["accounts"]["session"]), sessions, accounts.ProgramId, (long)plans["inputs"]["now"]);
            var run = RunPlanSnapshot.Decode(accounts, Envelope(plans["runs"]["daily"]), owner);
            var plan = planner.RunAction(actor, run, "move", Enumerable.Repeat((byte)7, 32).ToArray(), 1, 2, 4, 0);
            var result = await executor.Execute(plan, "move", new[] { signer }, observer);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Calls, Is.Zero); Assert.That(http.Count("simulateTransaction"), Is.Zero);
            var send = http.Requests.Single(r => (string)r["method"] == "sendTransaction");
            Assert.That((string)send["endpoint"], Is.EqualTo((string)rpcFixture["inputs"]["er"]));
            Assert.That((bool)send["params"][1]["skipPreflight"], Is.True); Assert.That((int)send["params"][1]["maxRetries"], Is.Zero);
            Assert.That(TransactionSignatures.Describe(http.Sent).VersionZero, Is.False);
        }

        [Test]
        public async Task ExclusiveIdleCleanupRejectsNewExecutionAndCancelledOldLeasesBeforeAnySigning()
        {
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var cleanup = executor.WithIdle(async () => { entered.SetResult(true); await release.Task; });
            await entered.Task;
            Assert.That((await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "during-cleanup", Array.Empty<DeviceSigner>(), observer)).Code, Is.EqualTo("execution-busy"));
            Assert.That((await executor.Resume(owner, observer)).Code, Is.EqualTo("execution-busy"));
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            release.SetResult(true); await cleanup;
            Assert.That((await executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "old-lease", Array.Empty<DeviceSigner>(), observer, cancelled.Token)).Code, Is.EqualTo("cancelled"));
            Assert.That(native.Calls, Is.Zero); Assert.That(http.Count("getLatestBlockhash"), Is.Zero);
        }

        [Test]
        public async Task DisconnectDuringWalletSigningDrainsExecutorAndRetainsTheInstallKey()
        {
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = solana["accounts"].Single(row => (string)row["id"] == "session-valid"); var token = sessions.Decode(Envelope(tokenRow));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)tokenRow["address"], token.ValidUntil);
            var lifecycle = new SessionLifecycle(identity, wallet, records, sessions, planner, null,
                new TransactionJournal(store), executor, observer, accounts.ProgramId, () => 1788912000);
            native.SignEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            native.SignRelease = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var lease = identity.Lease();
            var execution = executor.Execute(planner.Purchase(owner, 1, (string)solana["inputs"]["validator"]), "purchase-one", Array.Empty<DeviceSigner>(), observer, lease.Cancellation);
            await native.SignEntered.Task;
            var disconnect = lifecycle.Disconnect();
            Assert.That(identity.Owner, Is.Null); Assert.That(disconnect.IsCompleted, Is.False);
            Assert.That(native.Seed, Is.Not.Null);
            await AsyncAssert.Throws<InvalidOperationException>(() => identity.Connect(owner));
            native.SignRelease.SetResult(true);
            Assert.That((await execution).Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); await disconnect;
            Assert.That(native.Seed, Is.Not.Null); Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(device));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task DisconnectPreservesBothDurableSessionAndActiveKeyWhenJournalIsUnresolved()
        {
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var row = solana["accounts"].Single(value => (string)value["id"] == "session-valid"); var token = sessions.Decode(Envelope(row));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)row["address"], token.ValidUntil);
            var journal = new TransactionJournal(store); await journal.Begin(SignedPurchase());
            var lifecycle = new SessionLifecycle(identity, wallet, records, sessions, planner, null, journal, executor, observer, accounts.ProgramId, () => 1788912000);
            await lifecycle.Disconnect();
            Assert.That(identity.Owner, Is.Null); Assert.That(native.Seed, Is.Not.Null);
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(device)); Assert.That(await journal.Load(owner), Is.Not.Null);
        }

        [TestCase(-1)]
        [TestCase(61)]
        public async Task RenewalRevokesAndCreatesTheSameTokenAtomicallyWithTheInstallKey(long remaining)
        {
            var fixture = Fixture("device"); var row = fixture["cases"].Single(value => (long)value["remaining"] == remaining && (ulong)value["balance"] == 1000000);
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var oldToken = Envelope(row["oldToken"]); var old = sessions.Decode(oldToken);
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, oldToken.Address, old.ValidUntil);
            http.ExtraAccounts[oldToken.Address] = row["oldToken"];
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 1000000 };
            http.AfterSend = () =>
            {
                http.ExtraAccounts[oldToken.Address] = JValue.CreateNull();
                http.ExtraAccounts[device] = JValue.CreateNull();
                http.ExtraAccounts[(string)fixture["renewedToken"]["address"]] = fixture["renewedToken"];
                http.ExtraAccounts[(string)fixture["inputs"]["device"]] = new JObject { ["address"] = fixture["inputs"]["device"], ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            };
            var rpc = new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            var journal = new TransactionJournal(store);
            var reconciler = new ExecutionReconciler(protocol, accounts, sessions, records, planner, rpc, _ => Task.CompletedTask, _ => Task.CompletedTask);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var lifecycle = new SessionLifecycle(identity, wallet, records, sessions, planner, rpc, journal, executor, reconciler, accounts.ProgramId, () => (long)fixture["inputs"]["now"]);
            Assert.That((await lifecycle.EnableOrRenew()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            ZKube.Integration.Tests.ProgramScenarios.Equivalent(http.Sent, Convert.FromBase64String((string)row["signedTransaction"]));
            Assert.That(native.Creations, Is.Zero);
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo((string)fixture["inputs"]["device"]));
            using var access = await new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)fixture["inputs"]["now"]).Load(identity.Lease());
            Assert.That(access.Assessment.Current, Is.True); Assert.That(access.Assessment.Funding, Is.EqualTo("ready"));
        }

        [Test]
        public async Task RefillKeepsIdentityAndRevokeClosesTheTokenWhileRetainingTheInstallKey()
        {
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)tokenRow["address"], token.ValidUntil);
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow;
            var funded = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 1000000 };
            http.ExtraAccounts[device] = funded;
            var rpc = new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var journal = new TransactionJournal(store); var reconciler = new ExecutionReconciler(new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson), accounts, sessions, records, planner, rpc, _ => Task.CompletedTask, _ => Task.CompletedTask);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var lifecycle = new SessionLifecycle(identity, wallet, records, sessions, planner, rpc, journal, executor, reconciler, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            http.AfterSend = () => funded["lamports"] = PlanningConstants.DeviceAllowanceLamports;
            Assert.That((await lifecycle.Refill()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Seed, Is.Not.Null); Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(device));
            http.AfterSend = () => { funded["lamports"] = 0; http.ExtraAccounts[(string)tokenRow["address"]] = JValue.CreateNull(); http.Confirmation = "processed"; };
            Assert.That((await lifecycle.Revoke()).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(native.Seed, Is.Not.Null); Assert.That(await journal.Load(owner), Is.Not.Null);
            http.Confirmation = "confirmed";
            Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Seed, Is.Not.Null); Assert.That((await records.Load(owner)).Active, Is.Null);
        }

        [Test]
        public async Task ExplicitClaimUsesEachBoardSealingWindowEvenForADailyOutsideDiscoveryHistory()
        {
            var economy = Fixture("economy");
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)tokenRow["address"], token.ValidUntil);
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow;
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            foreach (string name in new[] { "oldDaily", "oldScore", "oldExpiredTheme" }) http.ExtraAccounts[(string)economy[name]["address"]] = economy[name];
            var rpc = new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            var journal = new TransactionJournal(store); string accepted = null;
            var reconciler = new ExecutionReconciler(protocol, accounts, sessions, records, planner, rpc, value => { accepted = value; return Task.CompletedTask; }, _ => Task.CompletedTask);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var sessionAccess = new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            var client = new EconomyClient(identity, sessionAccess, new ProductQueries(identity, accounts, planner, rpc, () => (long)plans["inputs"]["now"]), planner, journal, executor, reconciler);
            uint day = (uint)economy["oldDay"];
            Assert.That(day, Is.LessThan((uint)plans["inputs"]["day"] - PlanningConstants.ClaimLookbackDays));
            await AsyncAssert.Throws<InvalidOperationException>(() => client.Claim(day, "theme"));
            Assert.That(http.Count("sendTransaction"), Is.Zero);
            http.AfterSend = () => http.ExtraAccounts[(string)economy["oldScore"]["address"]] = economy["oldScoreClaimed"];
            Assert.That((await client.Claim(day, "score")).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            ZKube.Integration.Tests.ProgramScenarios.Equivalent(http.Sent, Convert.FromBase64String((string)economy["oldScoreTransaction"]));
            Assert.That(accepted, Is.EqualTo(owner));
            Assert.That(native.Calls, Is.EqualTo(1), "The device claim must not open the wallet again");
        }

        private sealed class Http
        {
            public readonly TestHttp Transport;

            private readonly ConcurrentQueue<string> events; private readonly TestMemory store;
            private readonly JObject rpc, solana, plans; private readonly string owner;
            public ConcurrentQueue<JObject> Requests => Transport.Requests;
            public string Confirmation = "confirmed"; public ulong AccountSlot = 1000, Height = 400;
            public ulong Fee = 5400, Balance = 1000000000, Rent = 890880;
            public bool ThrowAfterSend, AbsentNonPlayer;
            public JToken StatusError, SimulationError;
            public byte[] Sent;
            public Action AfterSend;
            public readonly Dictionary<string, JToken> ExtraAccounts = new Dictionary<string, JToken>();
            public Http(ConcurrentQueue<string> events, TestMemory store, JObject rpc, JObject solana, JObject plans, string owner)
            { Transport = new TestHttp { Reply = Respond }; this.events = events; this.store = store; this.rpc = rpc; this.solana = solana; this.plans = plans; this.owner = owner; }
            public int Count(string method) => Requests.Count(request => (string)request["method"] == method);
            private async Task<JToken> Respond(Uri endpoint, JObject request, CancellationToken cancellation)
            {
                await Task.Yield(); cancellation.ThrowIfCancellationRequested();
                string method = (string)request["method"];
                events.Enqueue(method);
                JToken result;
                switch (method)
                {
                    case "getGenesisHash": result = rpc["inputs"]["expectedGenesis"]; break;
                    case "getLatestBlockhash": result = TestHttp.Context(new JObject { ["blockhash"] = solana["inputs"]["blockhash"], ["lastValidBlockHeight"] = 500 }, 1000); break;
                    case "getFeeForMessage": result = TestHttp.Context(new JValue(Fee), 1000); break;
                    case "getBalance": result = TestHttp.Context(new JValue(Balance), 1000); break;
                    case "getMinimumBalanceForRentExemption": result = new JValue(Rent); break;
                    case "simulateTransaction":
                        var simulationError = SimulationError;
                        result = TestHttp.Context(new JObject { ["err"] = simulationError?.DeepClone() ?? JValue.CreateNull(), ["logs"] = new JArray(), ["unitsConsumed"] = 100 }, 1000); break;
                    case "sendTransaction":
                        Assert.That(store.Peek(owner, "journal"), Is.Not.Null, "Send ran before durable commit");
                        Sent = Convert.FromBase64String((string)request["params"][0]);
                        string signature = TransactionSignatures.ValidateFullySigned(Sent);
                        AfterSend?.Invoke();
                        if (ThrowAfterSend) throw new IOException("Synthetic response loss after submission");
                        result = new JValue(signature); break;
                    case "getSignatureStatuses": result = TestHttp.Context(new JArray(Confirmation == null ? JValue.CreateNull() : new JObject {
                        ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() }), 1000); break;
                    case "getBlockHeight": result = new JValue(Height); break;
                    case "getMultipleAccounts":
                        var addresses = request["params"][0].Values<string>().ToArray();
                        Assert.That(addresses.Length, Is.LessThanOrEqualTo(SolanaRpcTransport.MaximumBatchAccounts));
                        result = TestHttp.Context(new JArray(addresses.Select(Account)), AccountSlot); break;
                    case "getAccountInfo": result = TestHttp.Context(Account((string)request["params"][0]), AccountSlot); break;
                    case "getDelegationStatus": result = new JObject { ["isDelegated"] = true, ["fqdn"] = rpc["inputs"]["er"],
                        ["delegationRecord"] = new JObject { ["owner"] = rpc["inputs"]["program"], ["authority"] = plans["inputs"]["validator"], ["delegationSlot"] = 900, ["lamports"] = 1 } }; break;
                    default: throw new InvalidOperationException("Unexpected offline RPC " + method);
                }
                return result;
            }
            private JToken Account(string address)
            {
                if (ExtraAccounts.TryGetValue(address, out var extra))
                    return extra.Type == JTokenType.Null ? JValue.CreateNull() : new JObject { ["owner"] = extra["owner"], ["executable"] = extra["executable"],
                        ["lamports"] = extra["lamports"] ?? new JValue(5000000), ["data"] = new JArray(extra["data"], "base64") };
                var profile = solana["accounts"].Single(row => (string)row["id"] == "player-valid");
                JToken source = address == (string)profile["address"] ? profile : address == (string)plans["runs"]["daily"]["address"] ? plans["runs"]["daily"] : null;
                if (source != null) return new JObject { ["owner"] = source["owner"], ["executable"] = source["executable"], ["lamports"] = 1,
                    ["data"] = new JArray(source["data"], "base64") };
                if (AbsentNonPlayer) return JValue.CreateNull();
                return new JObject { ["owner"] = "11111111111111111111111111111111", ["executable"] = false, ["lamports"] = 1, ["data"] = new JArray("", "base64") };
            }

        }
    }
}
