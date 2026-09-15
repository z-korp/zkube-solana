using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client.Runs.Tests
{
    public sealed partial class RunClientTests
    {
        private static void Receipt(RunOperationReceipts scope, string owner, string mode, string address,
            params string[] intents)
        {
            Assert.That(scope.Steps.Select(s => s.Result.Intent), Is.EqualTo(intents));
            foreach (var step in scope.Steps)
            {
                Assert.That(step.Owner, Is.EqualTo(owner));
                Assert.That(step.Address, Is.EqualTo(address)); Assert.That(step.Result.Signature, Is.Not.Null.And.Not.Empty);
            }
        }

        [Test]
        public async Task RunReceiptRetainsPreparationAfterConfirmedSendAndRealObservationTimeout()
        {
            var env = await Environment.Create(); env.Http.Prepare("daily");
            var receipt = new RunOperationReceipts(env.Owner);
            // Confirm/reconcile the real preparation first; subsequent placement
            // reads lag behind. The actual bounded RunClient WaitFor must time out.
            env.Storage.AfterJournalComplete = () => env.Http.Delegated.Remove("daily");
            await Fails<TimeoutException>(async () => await env.Client.StartDaily(receipts: receipt));
            string address = (await env.Markers.Load(env.Owner)).ActiveRun;
            Receipt(receipt, env.Owner, "daily", address, "start-daily");
            Assert.That(receipt.Steps[0].Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
        }

        [Test]
        public async Task RunReceiptRetainsVrfAndActionAfterPostConfirmationObservationFailure()
        {
            foreach (string mode in new[] { "daily" })
            foreach (bool vrf in new[] { true, false })
            {
                var env = await Environment.Create(); if (vrf) env.Http.States[mode] = "prepared";
                var initial = await env.Client.Inspect();
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                var receipt = new RunOperationReceipts(env.Owner, binding.Address);
                env.Storage.AfterJournalComplete = () => env.Http.FailObservation = true;
                await Fails<IOException>(async () => {
                    if (vrf) await env.Client.ResolveVrf(binding, receipts: receipt);
                    else await env.Client.Apply(binding.Accept(initial), binding, RunClientAction.Reroll, receipts: receipt);
                });
                Receipt(receipt, env.Owner, mode, binding.Address, (vrf ? "vrf-" : "reroll-") + mode);
                Assert.That(receipt.Steps[0].Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
            }
        }

        [Test]
        public async Task RunReceiptBoundRecoveryKeepsFailureAndExpiryDistinctFromAcceptedSnapshot()
        {
            foreach (bool expired in new[] { false, true })
            {
                var env = await Environment.Create(); var initial = await env.Client.Inspect();
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                env.Http.Confirmed = false; env.Http.SuppressSendEffects = true;
                var sending = new RunOperationReceipts(env.Owner, binding.Address);
                await Fails<RunExecutionException>(async () => await env.Client.Apply(binding.Accept(initial), binding,
                    RunClientAction.Reroll, receipts: sending));
                Assert.That(sending.Steps.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                string signature = (await env.Journal.Load(env.Owner)).Signature;
                env.Http.Confirmed = !expired; env.Http.FailedOnChain = !expired;
                if (expired) env.Http.BlockHeight = 11001;
                var recovery = new RunOperationReceipts(env.Owner, binding.Address);
                var result = await env.Client.Recover(binding, receipts: recovery);
                Receipt(recovery, env.Owner, "daily", binding.Address, "reroll-daily");
                Assert.That(recovery.Steps.Single().Result.Signature, Is.EqualTo(signature));
                Assert.That(recovery.Steps.Single().Result.Outcome,
                    Is.EqualTo(expired ? ExecutionOutcome.ExpiredReconciled : ExecutionOutcome.ConfirmedFailure));
                Assert.That(result.Token.State, Is.EqualTo(initial.Token.State));
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
                Assert.That(sending.Steps.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending), "A later invocation cannot mutate an earlier receipt");
            }
        }

        [Test]
        public async Task RunReceiptRejectsReuseWrongOwnerAndRunBeforeSending()
        {
            var env = await Environment.Create(); var initial = await env.Client.Inspect();
            var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
            foreach (var invalid in new[] {
                new RunOperationReceipts("different-owner", binding.Address),
                new RunOperationReceipts(env.Owner, "different-run") })
            {
                int requests = env.Http.Requests;
                await Fails<InvalidOperationException>(async () => await env.Client.Apply(binding.Accept(initial), binding,
                    RunClientAction.Reroll, receipts: invalid));
                Assert.That(invalid.Steps, Is.Empty); Assert.That(env.Http.Requests, Is.EqualTo(requests));
            }
            Assert.That(env.Native.KeyLoads, Is.Zero); Assert.That(env.Http.Sent, Is.Empty);
            var receipt = new RunOperationReceipts(env.Owner, binding.Address);
            await env.Client.ResolveVrf(binding, receipts: receipt); // already ready: no execution
            int before = env.Http.Requests;
            await Fails<InvalidOperationException>(async () => await env.Client.Apply(binding.Accept(initial), binding,
                RunClientAction.Reroll, receipts: receipt));
            Assert.That(env.Http.Requests, Is.EqualTo(before)); Assert.That(receipt.Steps, Is.Empty);
        }

        [Test]
        public async Task RunReceiptStaleBoundRecoveryDoesNotClaimAnotherOwnerOrSuccessorOutcome()
        {
            foreach (bool ownerChanges in new[] { false, true })
            {
                var env = await Environment.Create(); var initial = await env.Client.Inspect();
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                env.Http.Confirmed = false;
                await Fails<RunExecutionException>(async () => await env.Client.Apply(binding.Accept(initial), binding, RunClientAction.Reroll));
                string signature = (await env.Journal.Load(env.Owner)).Signature;
                if (ownerChanges) await env.Identity.Disconnect(); else env.Http.ReplaceWithSuccessor(false, true);
                env.Http.Confirmed = true;
                var receipt = new RunOperationReceipts(env.Owner, binding.Address);
                var result = await env.Client.Recover(binding, receipts: receipt);
                Assert.That(result.Phase, Is.EqualTo(ownerChanges ? "identity-changed" : "run-unavailable"));
                Assert.That(receipt.Steps, Is.Empty);
                Assert.That((await env.Journal.Load(env.Owner)).Signature, Is.EqualTo(signature));
                Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
            }
        }

        [Test]
        public async Task RunReceiptSettlementRetainsEveryStepAndPartialCompletion()
        {
            foreach (string mode in new[] { "daily" })
            foreach (int failAfterStep in new[] { 0, 2, 3 })
            {
                var env = await Environment.Create(); var initial = await env.Client.Inspect();
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                var receipt = new RunOperationReceipts(env.Owner, binding.Address);
                var emptySnapshot = receipt.Steps;
                int completed = 0;
                env.Storage.AfterJournalComplete = () => { if (++completed == failAfterStep) env.Http.FailObservation = true; };
                if (failAfterStep != 0)
                    await Fails<IOException>(async () => await env.Client.FinishAndSettle(binding, receipts: receipt));
                else Assert.That((await env.Client.FinishAndSettle(binding, receipts: receipt)).Phase, Is.EqualTo("consumed"));
                Receipt(receipt, env.Owner, mode, binding.Address, failAfterStep == 2
                    ? new[] { "finish-" + mode, "commit-" + mode }
                    : new[] { "finish-" + mode, "commit-" + mode, "consume-" + mode });
                Assert.That(receipt.Steps.All(s => s.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                Assert.That(receipt.Steps.Select(s => s.Result.Signature).Distinct().Count(), Is.EqualTo(receipt.Steps.Count));
                Assert.That(emptySnapshot, Is.Empty, "Returned snapshots are immutable observations of that invocation");
                Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(receipt.Steps.Count));
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            }
        }

        [Test]
        public async Task RunReceiptCancellationAfterReconciliationRetainsActualConfirmedResult()
        {
            foreach (bool ownerChanged in new[] { false, true })
            {
            var env = await Environment.Create(); var initial = await env.Client.Inspect();
            var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
            using var cancel = new CancellationTokenSource();
            Task disconnect = Task.CompletedTask;
            env.Storage.AfterJournalComplete = () => { if (ownerChanged) disconnect = env.Identity.Disconnect(); else cancel.Cancel(); };
            var receipt = new RunOperationReceipts(env.Owner, binding.Address);
            await Fails<OperationCanceledException>(async () => await env.Client.Apply(binding.Accept(initial), binding,
                RunClientAction.Reroll, cancellation: cancel.Token, receipts: receipt));
            Receipt(receipt, env.Owner, "daily", binding.Address, "reroll-daily");
            Assert.That(receipt.Steps.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            await disconnect;
            if (ownerChanged) Assert.That(env.Identity.Owner, Is.Null);
            }
        }

        [Test]
        public async Task RunReceiptPreparedBaseResumeCapturesDelegationAndVrfSeparately()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "prepared"; env.Http.Delegated.Remove(mode);
                var initial = await env.Client.Inspect();
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                var receipt = new RunOperationReceipts(env.Owner, binding.Address);
                var ready = await env.Client.ResolveVrf(binding, receipts: receipt);
                Receipt(receipt, env.Owner, mode, binding.Address, "delegate-" + mode, "vrf-" + mode);
                Assert.That(receipt.Steps.All(s => s.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "delegate_active_run", "request_vrf" }));
                Assert.That(NativeEngine.Summary(ready.Token).Phase, Is.EqualTo((byte)ZKube.Core.Generated.CorePhase.Playing));
            }
        }

        [Test]
        public async Task RunReceiptRecoveryConfirmationSurvivesLaterReadFailure()
        {
            var env = await Environment.Create(); var initial = await env.Client.Inspect();
            var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
            env.Http.Confirmed = false;
            await Fails<RunExecutionException>(async () => await env.Client.Apply(binding.Accept(initial), binding, RunClientAction.Reroll));
            string signature = (await env.Journal.Load(env.Owner)).Signature;
            env.Http.Confirmed = true; env.Storage.AfterJournalComplete = () => env.Http.FailObservation = true;
            var receipt = new RunOperationReceipts(env.Owner, binding.Address);
            await Fails<IOException>(async () => await env.Client.Recover(binding, receipts: receipt));
            Receipt(receipt, env.Owner, "daily", binding.Address, "reroll-daily");
            Assert.That(receipt.Steps.Single().Result.Signature, Is.EqualTo(signature));
            Assert.That(receipt.Steps.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(await env.Journal.Load(env.Owner), Is.Null); Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
        }
    }
}
