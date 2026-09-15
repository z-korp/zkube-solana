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
    public sealed class TransactionExecutorTests
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
            var result = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(http.Sent, Is.EqualTo(SignedPurchase().Transaction));
            Assert.That(result.Signature, Is.EqualTo(SignedPurchase().Signature));
            var order = events.ToArray();
            Assert.That(Array.IndexOf(order, "simulateTransaction"), Is.LessThan(Array.IndexOf(order, "wallet")));
            Assert.That(Array.IndexOf(order, "wallet"), Is.LessThan(Array.IndexOf(order, "journal")));
            Assert.That(Array.LastIndexOf(order, "simulateTransaction"), Is.GreaterThan(Array.IndexOf(order, "wallet")));
            Assert.That(Array.LastIndexOf(order, "simulateTransaction"), Is.LessThan(Array.IndexOf(order, "journal")));
            Assert.That(http.Count("simulateTransaction"), Is.EqualTo(2));
            Assert.That(Array.IndexOf(order, "journal"), Is.LessThan(Array.IndexOf(order, "sendTransaction")));
            Assert.That(observer.Count, Is.EqualTo(1)); Assert.That(await store.Read(owner, "journal"), Is.Null);
            var expectedMessage = (string)solana["transactions"].Single(row => (string)row["id"] == "purchase-1")["message"];
            Assert.That((string)http.Requests.Single(request => (string)request["method"] == "getFeeForMessage")["params"][0], Is.EqualTo(expectedMessage));
        }

        [Test]
        public async Task RestartBeforeSendNeverSendsAndRequiresHistoryAfterExpiryAndFreshAbsentAccountEvidence()
        {
            var pending = SignedPurchase(); await new TransactionJournal(store).Begin(pending);
            http.Confirmation = null; http.Height = 400;
            var first = await NewExecutor().Resume(owner, observer);
            Assert.That(first.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            http.Height = 501; http.AbsentNonPlayer = true;
            var final = await NewExecutor().Resume(owner, new Observer(accounts, planner));
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
            var pending = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
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
            var first = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
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
            var fee = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(fee.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage)); Assert.That(native.Calls, Is.Zero);
            http.Balance = 1000000000; http.SimulationError = new JObject { ["InstructionError"] = new JArray(0, "InsufficientFunds") };
            var simulation = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(simulation.Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); Assert.That(native.Calls, Is.Zero);
            http.SimulationError = null; native.Reject = true;
            var rejected = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(rejected.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task SignedSimulationRejectionNeverJournalsOrSendsTheWalletResult()
        {
            http.SignedSimulationError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            var result = await executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            Assert.That(result.Code, Is.EqualTo("signed-simulation-rejected"));
            Assert.That(http.Count("simulateTransaction"), Is.EqualTo(2)); Assert.That(native.Calls, Is.EqualTo(1));
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
            var observed = await executor.Execute(planner.Purchase(owner, 25), "purchase-twenty-five", Array.Empty<DeviceSigner>(), observer);
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
                var submission = await executor.Execute(planner.Purchase(owner, 25), "purchase-twenty-five", Array.Empty<DeviceSigner>(), observer);
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
            var run = RunPlanSnapshot.Decode(accounts, Envelope(plans["runs"]["campaign"]), owner);
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
            Assert.That((await executor.Execute(planner.Purchase(owner, 1), "during-cleanup", Array.Empty<DeviceSigner>(), observer)).Code, Is.EqualTo("execution-busy"));
            Assert.That((await executor.Resume(owner, observer)).Code, Is.EqualTo("execution-busy"));
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            release.SetResult(true); await cleanup;
            Assert.That((await executor.Execute(planner.Purchase(owner, 1), "old-lease", Array.Empty<DeviceSigner>(), observer, cancelled.Token)).Code, Is.EqualTo("cancelled"));
            Assert.That(native.Calls, Is.Zero); Assert.That(http.Count("getLatestBlockhash"), Is.Zero);
        }

        [Test]
        public async Task DisconnectDuringWalletSigningDrainsExecutorBeforeDeletingKeyAndBlocksReconnect()
        {
            native.DeviceSeed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = solana["accounts"].Single(row => (string)row["id"] == "session-valid"); var token = sessions.Decode(Envelope(tokenRow));
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, device, (string)tokenRow["address"], token.ValidUntil), null));
            var lifecycle = new SessionLifecycle(identity, wallet, null, records, sessions, planner, null,
                new TransactionJournal(store), executor, observer, accounts.ProgramId, () => 1788912000);
            native.SignEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            native.SignRelease = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var lease = identity.Lease();
            var execution = executor.Execute(planner.Purchase(owner, 1), "purchase-one", Array.Empty<DeviceSigner>(), observer, lease.Cancellation);
            await native.SignEntered.Task;
            var disconnect = lifecycle.Disconnect();
            Assert.That(identity.Owner, Is.Null); Assert.That(disconnect.IsCompleted, Is.False);
            Assert.That(native.Deletions, Is.Zero);
            await AsyncAssert.Throws<InvalidOperationException>(() => identity.Connect(owner));
            native.SignRelease.SetResult(true);
            Assert.That((await execution).Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); await disconnect;
            Assert.That(native.Deletions, Is.EqualTo(1)); Assert.That((await records.Load(owner)).Active, Is.Null);
            Assert.That(http.Count("sendTransaction"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }

        [Test]
        public async Task DisconnectPreservesBothDurableSessionAndActiveKeyWhenJournalIsUnresolved()
        {
            native.DeviceSeed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var row = solana["accounts"].Single(value => (string)value["id"] == "session-valid"); var token = sessions.Decode(Envelope(row));
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, device, (string)row["address"], token.ValidUntil), null));
            var journal = new TransactionJournal(store); await journal.Begin(SignedPurchase());
            var lifecycle = new SessionLifecycle(identity, wallet, null, records, sessions, planner, null, journal, executor, observer, accounts.ProgramId, () => 1788912000);
            await lifecycle.Disconnect();
            Assert.That(identity.Owner, Is.Null); Assert.That(native.Deletions, Is.Zero); Assert.That(native.DeviceSeed, Is.Not.Null);
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(device)); Assert.That(await journal.Load(owner), Is.Not.Null);
        }

        [Test]
        public async Task EnableRenewalUsesActualPlanAndPromotesOnlyAfterConfirmedFreshCandidate()
        {
            var fixture = Fixture("unity-session-plans-v1.json"); var row = fixture["cases"][1];
            native.DeviceSeed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var oldToken = Envelope(row["oldToken"]); var old = sessions.Decode(oldToken);
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, device, oldToken.Address, old.ValidUntil), null));
            http.ExtraAccounts[oldToken.Address] = row["oldToken"];
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 1000000 };
            http.AfterSend = () =>
            {
                http.ExtraAccounts[oldToken.Address] = JValue.CreateNull();
                http.ExtraAccounts[device] = JValue.CreateNull();
                http.ExtraAccounts[(string)fixture["candidateToken"]["address"]] = fixture["candidateToken"];
                http.ExtraAccounts[(string)fixture["inputs"]["candidate"]] = new JObject { ["address"] = fixture["inputs"]["candidate"], ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            };
            var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            var keys = new DeviceKeyLifecycle(native); var journal = new TransactionJournal(store);
            var reconciler = new SessionInstructionReconciler(protocol, accounts, sessions, records, new SessionHandoff(records, keys, sessions, accounts.ProgramId), planner);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var lifecycle = new SessionLifecycle(identity, wallet, keys, records, sessions, planner, rpc, journal, executor, reconciler, accounts.ProgramId, () => (long)fixture["inputs"]["now"]);
            Assert.That((await lifecycle.EnableOrRenew()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(http.Sent, Is.EqualTo(Convert.FromBase64String((string)row["signedTransaction"])));
            Assert.That(native.Promotions, Is.EqualTo(1)); Assert.That(native.Candidate, Is.Null);
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo((string)fixture["inputs"]["candidate"]));
            using var access = await new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)fixture["inputs"]["now"]).Load(identity.Lease());
            Assert.That(access.Assessment.Current, Is.True); Assert.That(access.Assessment.Funding, Is.EqualTo("ready"));
        }

        [Test]
        public async Task RefillKeepsIdentityAndRevokeRemovesItOnlyAfterFreshConfirmedReclaim()
        {
            native.DeviceSeed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, device, (string)tokenRow["address"], token.ValidUntil), null));
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow;
            var funded = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 1000000 };
            http.ExtraAccounts[device] = funded;
            var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var journal = new TransactionJournal(store); var reconciler = new SessionMaintenanceReconciler(wallet, records);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var lifecycle = new SessionLifecycle(identity, wallet, null, records, sessions, planner, rpc, journal, executor, reconciler, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            http.AfterSend = () => funded["lamports"] = PlanningConstants.DeviceAllowanceLamports;
            Assert.That((await lifecycle.Refill()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Deletions, Is.Zero); Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(device));
            http.AfterSend = () => { funded["lamports"] = 0; http.Confirmation = "processed"; };
            Assert.That((await lifecycle.Revoke()).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(native.Deletions, Is.Zero); Assert.That(await journal.Load(owner), Is.Not.Null);
            http.Confirmation = "confirmed";
            Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Deletions, Is.EqualTo(1)); Assert.That((await records.Load(owner)).Active, Is.Null);
        }

        [Test]
        public async Task ExplicitClaimUsesEachBoardSealingWindowEvenForADailyOutsideDiscoveryHistory()
        {
            var economy = Fixture("unity-economy-v1.json");
            native.DeviceSeed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, device, (string)tokenRow["address"], token.ValidUntil), null));
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow;
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            foreach (string name in new[] { "oldDaily", "oldScore", "oldExpiredTheme" }) http.ExtraAccounts[(string)economy[name]["address"]] = economy[name];
            var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            var journal = new TransactionJournal(store); EconomyObservation accepted = null;
            var reconciler = new EconomyInstructionReconciler(protocol, accounts, rpc, value => { accepted = value; return Task.CompletedTask; });
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var sessionAccess = new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            var client = new EconomyClient(identity, sessionAccess, new ProductQueries(identity, accounts, planner, rpc, () => (long)plans["inputs"]["now"]), planner, journal, executor, reconciler);
            uint day = (uint)economy["oldDay"];
            Assert.That(day, Is.LessThan((uint)plans["inputs"]["day"] - PlanningConstants.ClaimLookbackDays));
            await AsyncAssert.Throws<InvalidOperationException>(() => client.Claim(day, "theme"));
            Assert.That(http.Count("sendTransaction"), Is.Zero);
            http.AfterSend = () => http.ExtraAccounts[(string)economy["oldScore"]["address"]] = economy["oldScoreClaimed"];
            Assert.That((await client.Claim(day, "score")).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(http.Sent, Is.EqualTo(Convert.FromBase64String((string)economy["oldScoreTransaction"])));
            Assert.That(accepted.ClaimState, Is.EqualTo("claimed")); Assert.That(accepted.DayId, Is.EqualTo(day));
            Assert.That(native.Calls, Is.EqualTo(1), "The device claim must not open the wallet again");
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
                    case "getMinimumBalanceForRentExemption": result = new JValue(Rent); break;
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
