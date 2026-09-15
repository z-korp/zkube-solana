using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneySessionFlowTests
    {
        private static Task<MoneyEvidenceGraph> Create(string scenario) => MoneyEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [Test] public async Task SessionReadsNeverResumeEvenAConfirmedErrorAndKeepTheOriginalJournal()
        {
            var graph = await Create("pending-confirmed-failure"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); graph.ConfirmPendingFailure();
                var pending = await graph.Services.Journal.Load(graph.Owner); int before = graph.Calls.Count;
                var read = await flow.RefreshSession();
                Assert.That(read.Value.Session.Status, Is.EqualTo("none"));
                Assert.That(read.Value.Pending.Signature, Is.EqualTo(pending.Signature));
                Assert.That((await graph.Services.Journal.Load(graph.Owner)).Signature, Is.EqualTo(pending.Signature));
                Assert.That(graph.Calls.Skip(before).Any(call => call.Boundary == "base" || call.Operation == "authorize"), Is.False);
                var receipt = (await flow.ResumePending()).Value;
                Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
                Assert.That(receipt.Signature, Is.EqualTo(pending.Signature));
                Assert.That(read.IsCurrent, Is.False);
                Assert.That((await flow.RefreshSession()).Value.Pending, Is.Null);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task SessionObservationCannotSurviveSupersessionDisconnectOrStop()
        {
            var graph = await Create("owner-overview"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect();
                var first = await flow.RefreshSession(); var next = await flow.RefreshSession();
                Assert.That(first.IsCurrent, Is.False); Assert.That(next.IsCurrent, Is.True);
                Assert.Throws<OperationCanceledException>(() => { var unused = first.Value; });
                await flow.Disconnect(); Assert.That(next.IsCurrent, Is.False);
                await flow.Connect(); var fresh = await flow.RefreshSession();
                await flow.StopAsync(); Assert.That(fresh.IsCurrent, Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task PrecancelledSessionReadHasNoNativeOrTransportEffects()
        {
            var graph = await Create("owner-overview"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); int before = graph.Calls.Count;
                using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
                try { await flow.RefreshSession(cancelled.Token); Assert.Fail("Expected cancellation"); }
                catch (OperationCanceledException) { }
                Assert.That(graph.Calls.Count, Is.EqualTo(before));
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task ExplicitEnsureRecoverKeepsPriorPurchaseIdentityAndDoesNotStartSessionSetup()
        {
            var graph = await Create("pending-confirmed-failure"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var saved = await graph.Services.Journal.Load(graph.Owner);
                graph.ConfirmPendingFailure();
                var result = (await flow.EnsureSession()).Value;
                Assert.That(result.Action, Is.EqualTo("recover"));
                Assert.That(result.Ready, Is.False);
                Assert.That(result.Operation.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
                Assert.That(result.Operation.Signature, Is.EqualTo(saved.Signature));
                Assert.That(result.Operation.Intent, Is.EqualTo(saved.Intent));
                Assert.That(graph.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
