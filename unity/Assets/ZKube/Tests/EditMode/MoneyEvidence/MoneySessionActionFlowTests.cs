using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneySessionActionFlowTests
    {
        private static Task<MoneySessionEvidenceGraph> Create(string scenario) => MoneySessionEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [TestCase("session-enable-success", "ensure", ExecutionOutcome.ConfirmedSuccess)]
        [TestCase("session-refill-success", "refill", ExecutionOutcome.ConfirmedSuccess)]
        [TestCase("session-disable-zero", "disable", ExecutionOutcome.CompletedLocally)]
        [TestCase("session-owner-decline", "ensure", ExecutionOutcome.Rejected)]
        [TestCase("session-fee-shortage", "ensure", ExecutionOutcome.FeeShortage)]
        [TestCase("session-renew-expired", "ensure", ExecutionOutcome.ConfirmedSuccess)]
        public async Task ExplicitTrackedActionRetainsItsRealOutcomeAndFreshSession(string scenario, string action, ExecutionOutcome expected)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var before = await flow.RefreshSession();
                Assert.That(graph.SentSignature, Is.Null);
                var result = action == "ensure" ? (await flow.EnsureSession()).Value.Operation :
                    action == "refill" ? (await flow.RefillSession()).Value : (await flow.RevokeSession()).Value;
                Assert.That(result.Outcome, Is.EqualTo(expected), result.Code);
                Assert.That(before.IsCurrent, Is.False);
                var after = (await flow.RefreshSession()).Value;
                Assert.That(after.Pending, Is.Null);
                if (expected == ExecutionOutcome.ConfirmedSuccess)
                { Assert.That(after.Session.Current, Is.True); Assert.That(after.Session.Funding, Is.EqualTo("ready")); Assert.That(result.Signature, Is.EqualTo(graph.SentSignature)); }
                else
                { Assert.That(after.Session.Status, Is.EqualTo("none")); Assert.That(graph.SentSignature, Is.Null); }
                if (action == "refill") Assert.That(graph.Calls.Any(call => call.Operation == "create-candidate"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task PendingDisableIsOnlyObservedUntilExplicitCheckPreservesSignatureAndDeletesKey()
        {
            var graph = await Create("session-disable-pending-success"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var result = (await flow.RevokeSession()).Value;
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(graph.HasActiveKey, Is.True);
                graph.ConfirmPendingSuccess(); int before = graph.Calls.Count;
                var read = (await flow.RefreshSession()).Value;
                Assert.That(read.Pending.Signature, Is.EqualTo(result.Signature)); Assert.That(graph.HasActiveKey, Is.True);
                Assert.That(graph.Calls.Skip(before).Any(call => call.Operation == "getSignatureStatuses"), Is.False);
                var confirmed = (await flow.ResumePending()).Value;
                Assert.That(confirmed.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(confirmed.Signature, Is.EqualTo(result.Signature)); Assert.That(confirmed.Intent, Is.EqualTo(result.Intent));
                Assert.That(graph.HasActiveKey, Is.False);
                Assert.That((await flow.RefreshSession()).Value.Session.Status, Is.EqualTo("none"));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [TestCase("session-disable-pending-success", ExecutionOutcome.ConfirmedSuccess)]
        [TestCase("session-enable-pending-failure", ExecutionOutcome.ConfirmedFailure)]
        public async Task OwnerRefreshConfirmationReplacesPendingReceiptForEveryPageAndEmptyCheckRetainsIt(string scenario, ExecutionOutcome outcome)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect();
                var pending = scenario == "session-disable-pending-success" ? (await flow.RevokeSession()).Value :
                    (await flow.EnsureSession()).Value.Operation;
                Assert.That(pending.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                var before = await flow.RefreshSession();
                Assert.That(before.Value.PreviousOperation, Is.SameAs(pending));
                if (outcome == ExecutionOutcome.ConfirmedSuccess) graph.ConfirmPendingSuccess(); else graph.ConfirmPendingFailure();
                var owner = (await flow.RefreshOwner()).Value;
                var exact = owner.PreviousOperation;
                Assert.That(exact.Outcome, Is.EqualTo(outcome));
                Assert.That(exact.Signature, Is.EqualTo(pending.Signature)); Assert.That(exact.Intent, Is.EqualTo(pending.Intent));
                Assert.That(owner.Pending, Is.Null); Assert.That(before.IsCurrent, Is.False);
                var session = (await flow.RefreshSession()).Value;
                Assert.That(session.PreviousOperation, Is.SameAs(exact)); Assert.That(session.RecoveredOperation, Is.True);
                int signedCalls = graph.Calls.Count(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction");
                var empty = (await flow.ResumePending()).Value;
                Assert.That(empty.Code, Is.EqualTo("no-pending-transaction"));
                Assert.That((await flow.RefreshOwner()).Value.PreviousOperation, Is.SameAs(exact));
                Assert.That((await flow.RefreshSession()).Value.PreviousOperation, Is.SameAs(exact));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.EqualTo(signedCalls));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task StopDrainsATrackedRefillWalletCallbackBeforeResourcesCanBeRetired()
        {
            var graph = await Create("session-refill-success"); var flow = new MoneyAppFlow(graph.Services);
            var hold = graph.HoldNextWallet();
            try
            {
                await flow.Connect(); var operation = flow.RefillSession(); await hold.Entered;
                var stop = flow.StopAsync(); Assert.That(stop.IsCompleted, Is.False);
                hold.Release();
                try { await operation; Assert.Fail("Stopped publication cannot be returned"); }
                catch (OperationCanceledException) { }
                await stop;
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); await flow.StopAsync(); }
        }

        [TestCase("transport")]
        [TestCase("malformed")]
        [TestCase("timeout")]
        public async Task ConfirmedEnsurePreservesItsExactReceiptWhenPostAcceptanceReadbackFails(string fault)
        {
            var graph = await Create("session-enable-success"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect();
                if (fault == "malformed") graph.CorruptFirstReadAfterJournalClear();
                else if (fault == "timeout") graph.TimeoutFirstReadAfterJournalClear();
                else graph.FailFirstReadAfterJournalClear();
                var result = (await flow.EnsureSession()).Value;
                Assert.That(result.Operation.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(result.Operation.Signature, Is.EqualTo(graph.SentSignature));
                Assert.That(result.Operation.Intent, Is.EqualTo("session-renew"));
                Assert.That(result.Session, Is.Null); Assert.That(result.Ready, Is.False);
                Assert.That(result.ReadbackError, Is.Not.Null);
                if (fault == "malformed") Assert.That(result.ReadbackError, Is.InstanceOf<FormatException>());
                if (fault == "timeout") Assert.That(result.ReadbackError, Is.InstanceOf<OperationCanceledException>());
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null, "The failure occurs after durable acceptance");
                var fresh = (await flow.RefreshSession()).Value;
                Assert.That(fresh.PreviousOperation, Is.SameAs(result.Operation));
                Assert.That(fresh.Session.Current, Is.True); Assert.That(fresh.Session.Funding, Is.EqualTo("ready"));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task SameOwnerRefreshSupersedesCallbackButRecoversExactReceiptOnlyThroughAFreshRead()
        {
            var graph = await Create("session-enable-success"); var flow = new MoneyAppFlow(graph.Services);
            var hold = graph.HoldNextWallet();
            try
            {
                await flow.Connect(); var operation = flow.EnsureSession(); await hold.Entered;
                var foreground = await flow.RefreshSession();
                Assert.That(foreground.Value.PreviousOperation, Is.Null);
                hold.Release();
                try { await operation; Assert.Fail("The superseded callback must not publish"); }
                catch (OperationCanceledException) { }
                Assert.That(foreground.IsCurrent, Is.False, "Accepted receipt invalidates the earlier empty observation");
                var read = (await flow.RefreshSession()).Value; var receipt = read.PreviousOperation;
                Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(receipt.Signature, Is.EqualTo(graph.SentSignature)); Assert.That(receipt.Intent, Is.EqualTo("session-renew"));
                Assert.That((await flow.RefreshSession()).Value.PreviousOperation, Is.SameAs(receipt));
                await flow.Disconnect(); await flow.Connect();
                Assert.That((await flow.RefreshSession()).Value.PreviousOperation, Is.Null, "Reconnect creates a different identity lease, even for the same address");
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); await flow.StopAsync(); }
        }
    }
}
