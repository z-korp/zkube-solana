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
                (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId) { SlotWaitEvery = TimeSpan.FromMilliseconds(2) },
            new WalletClient(native), new TransactionJournal(store)) { PromptEvery = TimeSpan.FromMilliseconds(2) };
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
            string quoted = (string)http.Requests.Single(request => (string)request["method"] == "getFeeForMessage")["params"][0];
            ZKube.Integration.Tests.ProgramScenarios.EquivalentMessages(quoted, expectedMessage);
            // One message, with the owner and the install key as its two signers, is
            // the one priced, simulated, shown to the wallet, journaled and sent; it is
            // simulated already carrying the install key's signature.
            byte[] message = Convert.FromBase64String(quoted);
            byte[] simulated = Convert.FromBase64String((string)http.Requests.Single(request => (string)request["method"] == "simulateTransaction")["params"][0]);
            foreach (var bytes in new[] { simulated, native.Asked.Single(), http.Sent })
            {
                Assert.That(bytes[0], Is.EqualTo(2)); Assert.That(bytes.Skip(1 + 2 * 64), Is.EqualTo(message));
            }
            int slot = Array.IndexOf(TransactionSignatures.Describe(simulated).Accounts.Where(account => account.Signer).Select(account => account.Address).ToArray(), device);
            Assert.That(slot, Is.GreaterThanOrEqualTo(0), "The install key is this device's key");
            Assert.That(simulated.Skip(1 + 64 * slot).Take(64), Has.Some.Not.EqualTo((byte)0));
            Assert.That(native.Asked.Single(), Is.EqualTo(simulated), "The wallet is asked for exactly what was simulated");
            Assert.That(http.Sent.Skip(1 + 64 * slot).Take(64), Is.EqualTo(simulated.Skip(1 + 64 * slot).Take(64)));
        }

        // Every transaction the owner's wallet is asked to sign is signed by the
        // install key first, and no session is needed for that. An owner-only
        // intent gets the key as one trailing signer, made on a device that never
        // had one; intents that already carry the device's signature keep exactly
        // their signers; and an owner-only plan with no instruction that takes the
        // key is refused before any wallet is asked.
        [Test]
        public async Task EveryOwnerWalletActionIsPresignedWithoutRequiringASession()
        {
            string team = (string)solana["inputs"]["validator"];
            string[] Signers(TransactionPlan plan) => TransactionSignatures.Describe(SolanaWire.UnsignedTransaction(plan.CompileMessage((string)solana["inputs"]["blockhash"])))
                .Accounts.Where(account => account.Signer).Select(account => account.Address).ToArray();
            // The plan preparation, shape by shape.
            foreach (uint pack in new uint[] { 1, 10, 25 })
            {
                var purchase = planner.Purchase(owner, pack, team); var presigned = planner.Presigned(purchase, device);
                Assert.That(purchase.DeviceSigners, Is.Empty); Assert.That(presigned.DeviceSigners, Is.EqualTo(new[] { device }));
                Assert.That(Signers(presigned), Is.EquivalentTo(new[] { owner, device }));
                var last = presigned.Instructions[presigned.Instructions.Count - 1]; var trailing = last.Accounts[last.Accounts.Count - 1];
                Assert.That(trailing.Address, Is.EqualTo(device)); Assert.That(trailing.Signer, Is.True); Assert.That(trailing.Writable, Is.False);
                Assert.That(last.Accounts.Take(last.Accounts.Count - 1).Select(account => account.Address), Is.EqualTo(purchase.Instructions[0].Accounts.Select(account => account.Address)));
                Assert.That(last.Data, Is.EqualTo(purchase.Instructions[0].Data));
                Assert.That(presigned.FeePayer, Is.EqualTo(owner)); Assert.That(presigned.ComputeUnitLimit, Is.EqualTo(purchase.ComputeUnitLimit));
                ZKube.Integration.Tests.ProgramScenarios.EquivalentMessages(Convert.ToBase64String(presigned.CompileMessage((string)solana["inputs"]["blockhash"])),
                    (string)solana["transactions"].Single(row => (string)row["id"] == "purchase-" + pack)["message"]);
                Assert.That(SolanaWire.UnsignedTransaction(presigned.CompileMessage((string)solana["inputs"]["blockhash"])).Length, Is.LessThanOrEqualTo(SolanaWire.PacketBytes));
            }
            // Setup, renewal, refill and a revoke that returns a balance already carry the device's signature: nothing is added.
            foreach (var plan in new[] { planner.EnableSession(owner, device, 1000), planner.RenewSession(owner, device, 1000, null, 5),
                planner.RefillSession(owner, device, 0), planner.RevokeSession(owner, device, null, 5) })
            {
                Assert.That(plan.DeviceSigners, Is.EqualTo(new[] { device }));
                Assert.That(planner.Presigned(plan, device), Is.SameAs(plan));
            }
            // A device-paid plan is not an owner-wallet request.
            var devicePlan = planner.SetFeaturedIdentity(PlannerActor.Device(owner, device, Token(), sessions, accounts.ProgramId, (long)plans["inputs"]["now"]), 1, 0);
            Assert.That(devicePlan.OwnerSignatureRequired, Is.False); Assert.That(planner.Presigned(devicePlan, device), Is.SameAs(devicePlan));
            // The token-only revoke of a device that holds nothing: the key follows the revoke's four accounts.
            var revoke = planner.Presigned(planner.RevokeSession(owner, device, Token(), 0), device);
            Assert.That(revoke.Instructions.Single().Accounts.Count, Is.EqualTo(5));
            Assert.That(Signers(revoke), Is.EquivalentTo(new[] { owner, device }));
            // An owner-only plan whose instruction is not known to ignore a trailing account is not given one.
            var unaudited = planner.SetFeaturedIdentity(PlannerActor.Wallet(owner), 1, 0);
            Assert.Throws<InvalidOperationException>(() => planner.Presigned(unaudited, device));
            var refused = await executor.Execute(unaudited, "set-featured-identity", Array.Empty<DeviceSigner>(), observer);
            Assert.That(refused.Code, Is.EqualTo("preparation-failed"));
            Assert.That(native.Asked, Is.Empty); Assert.That(http.Count("simulateTransaction"), Is.Zero); Assert.That(await store.Read(owner, "journal"), Is.Null);

            // A device that never had a key makes one for the owner's purchase, before the wallet is asked.
            native.Seed = null; int made = native.Creations;
            var bought = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(bought.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(native.Creations, Is.EqualTo(made + 1)); Assert.That(native.Asked.Count, Is.EqualTo(1));
            Assert.That(Signers(planner.Presigned(planner.Purchase(owner, 1, team), device)), Is.EquivalentTo(TransactionSignatures.Describe(http.Sent).Accounts.Where(a => a.Signer).Select(a => a.Address)));
            // A key that cannot be made stops the purchase before the wallet, with nothing journaled or sent.
            native.Seed = null; native.ForbidKeyCreation = true; http.Sent = null;
            var unsaved = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
            Assert.That(unsaved.Code, Is.EqualTo("preparation-failed")); Assert.That(native.Asked.Count, Is.EqualTo(1));
            Assert.That(http.Sent, Is.Null); Assert.That(await store.Read(owner, "journal"), Is.Null);
        }
        private AccountEnvelope Token() => Envelope(plans["accounts"]["session"]);

        // A sent transaction is looked for at once and then promptly: the usual
        // outcome comes back with the call that sent it, at confirmed, with its
        // timing in the log. One that stays unconfirmed is handed on as pending
        // after a bounded number of checks.
        [Test]
        public async Task ASentTransactionIsLookedForPromptlyAndShownAtConfirmed()
        {
            string team = (string)solana["inputs"]["validator"];
            var lines = new List<string>(); var sink = ClientLog.Sink; ClientLog.Sink = line => { lock (lines) lines.Add(line); };
            try
            {
                http.UnseenStatuses = 3;
                var result = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(http.Count("getSignatureStatuses"), Is.EqualTo(4), "Three early looks, then the one that sees it confirmed");
                Assert.That(http.Requests.Where(request => (string)request["method"] == "getMultipleAccounts").All(request => (string)request["params"][1]["commitment"] == "confirmed"), Is.True);
                var timing = lines.Where(line => line.StartsWith("zKube timing: action=purchase-one ")).Select(line => line.Substring("zKube timing: action=purchase-one ".Length)).ToArray();
                Assert.That(timing.Length, Is.EqualTo(3), string.Join(" | ", lines));
                StringAssert.IsMatch(@"^sent=\+\d+ms$", timing[0]);
                StringAssert.IsMatch(@"^first-status=\+\d+ms seen=Missing$", timing[1]);
                StringAssert.IsMatch(@"^settled=\+\d+ms outcome=ConfirmedSuccess checks=4$", timing[2]);
                // The page that shows it closes the timing, once.
                ClientLog.Shown(result.Signature); ClientLog.Shown(result.Signature);
                Assert.That(lines.Count(line => System.Text.RegularExpressions.Regex.IsMatch(line, @"^zKube timing: action=purchase-one shown=\+\d+ms$")), Is.EqualTo(1));
                foreach (string line in lines) StringAssert.DoesNotContain(result.Signature, line);

                // Never seen: the checks are bounded and the transaction is the follower's.
                http.Sent = null; http.Confirmation = null;
                int before = http.Count("getSignatureStatuses");
                var unseen = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
                Assert.That(unseen.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.That(http.Count("getSignatureStatuses") - before, Is.EqualTo(1 + TransactionExecutor.PromptChecks));
                Assert.That(await store.Read(owner, "journal"), Is.Not.Null);
            }
            finally { ClientLog.Sink = sink; }
        }

        // The node that answers a read can be a slot or two behind the slot the
        // status named. That is not yet: the same read is made again shortly and
        // quietly, a bounded number of times, and the transaction settles in the
        // same call. A node that stays behind leaves it pending, with no failure line.
        [Test]
        public async Task ANodeBehindTheNamedSlotIsWaitedForQuietlyAndBounded()
        {
            string team = (string)solana["inputs"]["validator"];
            var lines = new List<string>(); var sink = ClientLog.Sink; ClientLog.Sink = line => { lock (lines) lines.Add(line); };
            try
            {
                http.BehindSlot = 3;
                var result = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(http.Count("getSignatureStatuses"), Is.EqualTo(1), "The status is not asked again while the node catches up");
                Assert.That(lines.Where(line => line.StartsWith("zKube request failed")), Is.Empty);

                http.Sent = null; http.BehindSlot = int.MaxValue;
                int reads = http.Count("getMultipleAccounts");
                var behind = await executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer);
                Assert.That(behind.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(behind.Code, Is.EqualTo("node-behind"));
                Assert.That(http.Count("getMultipleAccounts") - reads, Is.EqualTo((1 + TransactionExecutor.PromptChecks) * (1 + SolanaRpcTransport.SlotWaits)));
                Assert.That(lines.Where(line => line.StartsWith("zKube request failed")), Is.Empty);
            }
            finally { ClientLog.Sink = sink; }
        }

        // Every outcome that is not a success or still pending writes one line
        // where it is made: the action, the outcome, its code and what stopped it.
        // No rejection, before or after the wallet, leaves without one.
        [Test]
        public async Task EveryOutcomeThatIsNotASuccessLeavesOneLogLine()
        {
            string team = (string)solana["inputs"]["validator"];
            var lines = new List<string>(); var sink = ClientLog.Sink; ClientLog.Sink = line => { lock (lines) lines.Add(line); };
            try
            {
                string[] Failures() { lock (lines) return lines.Where(line => line.StartsWith("zKube request failed")).ToArray(); }
                async Task Expect(string line, Func<Task<ExecutionResult>> request)
                {
                    lines.Clear();
                    var result = await request();
                    Assert.That(Failures().Length, Is.EqualTo(1), result.Outcome + " " + result.Code + ": " + string.Join(" | ", lines));
                    StringAssert.StartsWith("zKube request failed: action=purchase-one " + line, Failures()[0]);
                    Assert.That(await store.Read(owner, "journal"), Is.Null); Assert.That(http.Sent, Is.Null);
                }
                Task<ExecutionResult> Buy(CancellationToken cancellation = default) =>
                    executor.Execute(planner.Purchase(owner, 1, team), "purchase-one", Array.Empty<DeviceSigner>(), observer, cancellation);
                await Expect("outcome=Rejected code=cancelled", () => Buy(new CancellationToken(true)));
                http.Balance = 0;
                await Expect("outcome=FeeShortage code=owner-fee-shortage", () => Buy()); http.Balance = 1000000000;
                http.SimulationError = new JArray("InstructionError", new JArray(2, new JObject { ["Custom"] = 6001 }));
                await Expect("outcome=Rejected code=simulation-rejected chain=\"['InstructionError',[2,{'Custom':6001}]]\"", () => Buy()); http.SimulationError = null;
                native.Reject = true;
                await Expect("outcome=Rejected code=wallet-rejected", () => Buy()); native.Reject = false;
                native.Seed = null; native.ForbidKeyCreation = true;
                await Expect("outcome=Rejected code=preparation-failed kind=Local type=InvalidOperationException", () => Buy()); native.ForbidKeyCreation = false;
                // The wallet approved and the request was withdrawn before it could be recorded: still one line.
                using (var withdrawn = new CancellationTokenSource())
                {
                    native.SignEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                    native.SignRelease = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                    await Expect("outcome=Rejected code=cancelled", async () => {
                        var asked = Buy(withdrawn.Token); await native.SignEntered.Task;
                        withdrawn.Cancel(); native.SignRelease.SetResult(true);
                        return await asked;
                    });
                    native.SignEntered = null; native.SignRelease = null;
                }
                // A success writes none.
                lines.Clear();
                Assert.That((await Buy()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess)); Assert.That(Failures(), Is.Empty);
                // A transaction that landed and failed says so with the chain's error.
                http.Sent = null; http.StatusError = new JArray("InstructionError", new JArray(2, new JObject { ["Custom"] = 6001 }));
                lines.Clear();
                var failed = await Buy();
                Assert.That(failed.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
                Assert.That(Failures().Length, Is.EqualTo(1), string.Join(" | ", lines));
                StringAssert.StartsWith("zKube request failed: action=purchase-one outcome=ConfirmedFailure code=- chain=\"", Failures()[0]);
            }
            finally { ClientLog.Sink = sink; }
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
            http.AfterSend = () => funded["lamports"] = DeviceFunding.DepositLamports;
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
        public async Task ExplicitClaimUsesTheDailysClaimWindowEvenOutsideDiscoveryHistory()
        {
            var economy = Fixture("economy");
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)tokenRow["address"], token.ValidUntil);
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow;
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            foreach (string name in new[] { "oldDailyExpired", "oldScore", "oldTheme" }) http.ExtraAccounts[(string)economy[name]["address"]] = economy[name];
            var rpc = new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            var journal = new TransactionJournal(store); string accepted = null;
            var reconciler = new ExecutionReconciler(protocol, accounts, sessions, records, planner, rpc, value => { accepted = value; return Task.CompletedTask; }, _ => Task.CompletedTask);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var sessionAccess = new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            var client = new EconomyClient(identity, sessionAccess, new ProductQueries(identity, accounts, planner, rpc, () => (long)plans["inputs"]["now"]), planner, journal, executor, reconciler);
            uint day = (uint)economy["oldDay"];
            Assert.That(day, Is.LessThan((uint)plans["inputs"]["day"] - PlanningConstants.ClaimLookbackDays));
            // Both boards share the Daily's one claim window: past it, neither is offered.
            foreach (string kind in new[] { "score", "theme" })
                await AsyncAssert.Throws<InvalidOperationException>(() => client.Claim(day, kind));
            Assert.That(http.Count("sendTransaction"), Is.Zero);
            http.ExtraAccounts[(string)economy["oldDaily"]["address"]] = economy["oldDaily"];
            http.AfterSend = () => http.ExtraAccounts[(string)economy["oldScore"]["address"]] = economy["oldScoreClaimed"];
            Assert.That((await client.Claim(day, "score")).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            ZKube.Integration.Tests.ProgramScenarios.Equivalent(http.Sent, Convert.FromBase64String((string)economy["oldScoreTransaction"]));
            Assert.That(accepted, Is.EqualTo(owner));
            Assert.That(native.Calls, Is.EqualTo(1), "The device claim must not open the wallet again");
        }

        [Test]
        public async Task AWinnerSealsOnlyAsManyFinishedDaysAsFitOneTransaction()
        {
            // Nine Dailies nobody finalized and no keeper. Each seal starts at
            // the root's oldest waiting day and carries what its simulation
            // accepts: two days, or one when two do not fit.
            var backlog = Fixture("economy")["cadence"]["backlog"]; var days = backlog["days"].Values<uint>().ToArray();
            native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var wallet = new WalletClient(native); var identity = new ClientIdentity(wallet); await identity.Connect(owner);
            var records = new SessionRecordStore(store, sessions, accounts.ProgramId);
            var tokenRow = plans["accounts"]["session"]; var token = sessions.Decode(Envelope(tokenRow));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(records, owner, device, (string)tokenRow["address"], token.ValidUntil);
            http.ExtraAccounts[(string)tokenRow["address"]] = tokenRow; http.AbsentNonPlayer = true;
            http.ExtraAccounts[device] = new JObject { ["address"] = device, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["data"] = "", ["lamports"] = 5000000 };
            foreach (var daily in backlog["dailies"]) http.ExtraAccounts[(string)daily["address"]] = daily;
            // The chain's clock at the read: the backlog's days are long over.
            http.ExtraAccounts[ZKube.Integration.Client.CadenceObservation.ClockSysvar] = TestClock.Sysvar((long)plans["inputs"]["now"]);
            var rpc = new SolanaRpcTransport(http.Transport, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], (string)rpcFixture["inputs"]["expectedGenesis"], accounts.ProgramId);
            var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            var journal = new TransactionJournal(store);
            var reconciler = new ExecutionReconciler(protocol, accounts, sessions, records, planner, rpc, _ => Task.CompletedTask, _ => Task.CompletedTask);
            executor = new TransactionExecutor(planner, rpc, wallet, journal);
            var sessionAccess = new SessionAccess(wallet, records, sessions, rpc, accounts.ProgramId, () => (long)plans["inputs"]["now"]);
            var client = new EconomyClient(identity, sessionAccess, new ProductQueries(identity, accounts, planner, rpc, () => (long)plans["inputs"]["now"]), planner, journal, executor, reconciler);
            (string, string, string)[] Sealed() => TransactionSignatures.Describe(http.Sent).Instructions.Where(ix => ix.ProgramId == protocol.ProgramId)
                .Select(protocol.DecodeInstruction).Select(call => (call.Name, call.Accounts["arena_daily"],
                    call.Accounts.TryGetValue("following_daily", out var following) ? following : null)).ToArray();
            (string, string, string) Step(int index) => ("finalize_arena_daily", planner.Daily(days[index]), planner.Daily(days[index + 1]));

            http.ExtraAccounts[planner.ProtocolAddress] = backlog["start"];
            Assert.That((await client.SettleDailies()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Sealed(), Is.EqualTo(new[] { Step(0), Step(1) }));
            // Two full days do not fit: the oldest goes alone, and the next seal takes the other.
            http.Fits = transaction => TransactionSignatures.Describe(transaction).Instructions.Count(ix => ix.ProgramId == protocol.ProgramId) < 2;
            Assert.That((await client.SettleDailies()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Sealed(), Is.EqualTo(new[] { Step(0) }));
            http.ExtraAccounts[planner.ProtocolAddress] = backlog["advanced"];
            Assert.That((await client.SettleDailies()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Sealed(), Is.EqualTo(new[] { Step(2) }));
            // The newest waiting day finalizes into today's Daily, prepared in the same transaction.
            http.Fits = null; http.ExtraAccounts[planner.ProtocolAddress] = backlog["last"];
            Assert.That((await client.SettleDailies()).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            uint today = (uint)plans["inputs"]["day"];
            Assert.That(Sealed(), Is.EqualTo(new[] { ("prepare_arena_daily", planner.Daily(today), (string)null),
                ("finalize_arena_daily", planner.Daily(days[8]), planner.Daily(today)) }));
            Assert.That(native.Calls, Is.EqualTo(1), "Sealing is the device's own transaction and never opens the wallet");
        }

        private sealed class Http
        {
            public readonly TestHttp Transport;
            // Which simulated transactions the cluster accepts; all of them when null.
            public Func<byte[], bool> Fits;

            private readonly ConcurrentQueue<string> events; private readonly TestMemory store;
            private readonly JObject rpc, solana, plans; private readonly string owner;
            public ConcurrentQueue<JObject> Requests => Transport.Requests;
            public string Confirmation = "confirmed"; public ulong AccountSlot = 1000, Height = 400;
            public ulong Fee = 5400, Balance = 1000000000, Rent = 890880;
            public bool ThrowAfterSend, AbsentNonPlayer;
            public JToken StatusError, SimulationError;
            // How many reads at a minimum slot find the node behind it; how many status requests see nothing yet.
            public int BehindSlot, UnseenStatuses;
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
                        var simulationError = SimulationError ?? (Fits == null || Fits(Convert.FromBase64String((string)request["params"][0])) ? null :
                            new JObject { ["InstructionError"] = new JArray(2, "ComputationalBudgetExceeded") });
                        result = TestHttp.Context(new JObject { ["err"] = simulationError?.DeepClone() ?? JValue.CreateNull(), ["logs"] = new JArray(), ["unitsConsumed"] = 100 }, 1000); break;
                    case "sendTransaction":
                        Assert.That(store.Peek(owner, "journal"), Is.Not.Null, "Send ran before durable commit");
                        Sent = Convert.FromBase64String((string)request["params"][0]);
                        string signature = TransactionSignatures.ValidateFullySigned(Sent);
                        AfterSend?.Invoke();
                        if (ThrowAfterSend) throw new IOException("Synthetic response loss after submission");
                        result = new JValue(signature); break;
                    case "getSignatureStatuses": result = TestHttp.Context(new JArray(Confirmation == null || UnseenStatuses-- > 0 ? JValue.CreateNull() : new JObject {
                        ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() }), 1000); break;
                    case "getBlockHeight": result = new JValue(Height); break;
                    case "getMultipleAccounts":
                        // A node still behind the slot the read names answers with its own error.
                        if (BehindSlot > 0 && request["params"][1]["minContextSlot"] != null) { BehindSlot--; throw new RpcErrorReply(-32016, "Minimum context slot has not been reached"); }
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
