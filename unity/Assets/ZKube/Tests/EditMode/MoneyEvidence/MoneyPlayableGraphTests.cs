using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Client.Runs;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyPlayableGraph
{
    public sealed class MoneyPlayableGraphTests
    {
        private static string Source(string mode) => File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../fixtures/unity-money-daily-playable-v1.json")));
        private static Task<MoneyPlayableEvidenceGraph> Create(string mode) => MoneyPlayableEvidenceGraph.Create(Source(mode),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
        private static async Task<MoneyRunLaunch> Open(MoneyPlayableEvidenceGraph graph, MoneyAppFlow flow)
        {
            await flow.Connect();
            var opening = flow.StartDailyRun();
            return await BindOpening(graph, opening);
        }
        private static async Task<MoneyRunLaunch> BindOpening(MoneyPlayableEvidenceGraph graph, Task<MoneyRead<MoneyRunLaunch>> opening)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            while (!opening.IsCompleted && (graph.NextCommand != "oracleVrf" || await graph.Services.Journal.Load(graph.Owner) != null))
                await Task.Delay(5, timeout.Token);
            if (!opening.IsCompleted) await graph.DeliverNextOracle();
            var result = (await opening).Value;
            Assert.That(result.Operation.Error, Is.Null, result.Operation.Error?.ToString());
            Assert.That(result.CanBind, Is.True);
            Assert.That(result.Operation.Receipts.All(receipt => receipt.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
            return result;
        }
        [Test] public async Task PendingDailyEntryCannotSpendAgainAndItsConfirmedRunResumes()
        {
            var graph = await Create("daily"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); graph.HoldNextConfirmation();
                var pending = (await flow.StartDailyRun()).Value;
                Assert.That(pending.CanBind, Is.False);
                Assert.That(pending.Operation.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.That(graph.SubmittedCount, Is.EqualTo(1));
                Assert.That((await flow.RefreshDaily()).Value.Entry.Ready, Is.False);
                try { await flow.StartDailyRun(); Assert.Fail("An unresolved entry must reject a second spend"); }
                catch (InvalidOperationException) { }
                Assert.That(graph.SubmittedCount, Is.EqualTo(1));
                graph.ConfirmPending();
                await flow.RefreshOwner();
                var resumed = await BindOpening(graph, flow.OpenSavedRun("daily"));
                Assert.That(resumed.Run.Mode, Is.EqualTo("daily"));
                Assert.That(graph.Calls.Count(call => call.Operation == "accepted-entry"), Is.EqualTo(1));
                Assert.That((await flow.RefreshDaily()).Value.Lobby.Profile.Kredits, Is.EqualTo(24));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        private static async Task<MoneyRunHandle> PlayToTerminal(MoneyPlayableEvidenceGraph graph, MoneyAppFlow flow)
        {
            var launch = await Open(graph, flow); var run = launch.Run;
            MoneyRunOperation operation = null;
            var provider = new RunBoardActionProvider(run.Binding,
                async (accepted, action, row, start, destination, cancellation) =>
                    (operation = (await flow.SubmitRun(run, accepted, action, row, start, destination, graph.Clock(), cancellation)).Value).RequireState(),
                async cancellation => (operation = (await flow.ResolveRun(run, cancellation)).Value).RequireState(),
                async cancellation => (operation = (await flow.RecoverRun(run, cancellation)).Value).RequireState(),
                async cancellation => (operation = (await flow.SettleRun(run, cancellation)).Value).RequireState());
            var token = provider.Bind(launch.Operation.State, "Trial 1").Accepted;
            var fixture = JObject.Parse(Source(graph.Mode));
            while (graph.NextCommand != "commit")
            {
                var step = fixture["steps"][graph.StepIndex]; var command = step["command"];
                BoardActionResult accepted;
                if ((string)command["kind"] == "oracleVrf")
                { await graph.DeliverNextOracle(); accepted = await provider.ResolveVrf(token, default); Assert.That(accepted.IsSnapshot, Is.True); }
                else
                {
                    var kind = (string)command["kind"] == "move" ? BoardActionKind.Move :
                        (string)command["kind"] == "bonus" ? BoardActionKind.Guardian : BoardActionKind.Reroll;
                    var action = new BoardAction(kind, (byte?)command["row"] ?? 0,
                        kind == BoardActionKind.Guardian ? (byte)command["column"] : (byte?)command["start"] ?? 0,
                        (byte?)command["destination"] ?? 0);
                    accepted = await provider.Submit(token, action, default);
                    Assert.That(operation.Error, Is.Null, operation.Error?.ToString());
                    Assert.That(operation.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                    Assert.That(accepted.IsSnapshot, Is.False, "Observed native action keeps its verified presentation trace");
                    CollectionAssert.AreEqual(NativeEngine.Summary(accepted.Token).Grid,
                        PresentationTrace.ProjectBoard(NativeEngine.Summary(token).Grid, accepted.Transition.Events));
                }
                Assert.That(operation.Error, Is.Null, operation.Error?.ToString()); token = accepted.Token;
                CollectionAssert.AreEqual(Convert.FromBase64String((string)step["account"]["token"]["state"]), token.State);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
            }
            var final = fixture["steps"].Last["account"]["token"]["state"];
            CollectionAssert.AreEqual(Convert.FromBase64String((string)final), token.State);
            Assert.That(NativeEngine.Summary(token).Phase, Is.EqualTo((byte)CorePhase.Finished));
            return run;
        }
        [TestCase("daily")] public async Task ActualCompositionExecutesTheEntireNativeRunAndConsumesItsResultOnce(string mode)
        {
            var graph = await Create(mode); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var run = await PlayToTerminal(graph, flow);
                var result = (await flow.SettleRun(run)).Value;
                Assert.That(result.Error, Is.Null, result.Error?.ToString());
                Assert.That(result.State.Phase, Is.EqualTo("consumed"));
                Assert.That(result.Receipts.Select(receipt => receipt.Result.Intent), Is.EqualTo(new[] { "commit-" + mode, "consume-" + mode }));
                Assert.That(result.Receipts.All(receipt => receipt.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                Assert.That(graph.Consumed, Is.True); Assert.That(graph.NextCommand, Is.Null);
                Assert.That(await graph.Services.RunMarkers.Load(graph.Owner, mode), Is.Null);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                var progress = (await flow.RefreshCampaign()).Value;
                Assert.That(progress.Browse.Realms[0].Levels[0].Stars, Is.EqualTo(0));
                if (mode == "daily")
                {
                    var daily = (await flow.RefreshDaily()).Value;
                    Assert.That(daily.Lobby.Profile.Kredits, Is.EqualTo(24));
                    Assert.That(daily.Lobby.Profile.LadderPoints, Is.EqualTo(200));
                    Assert.That((uint)daily.Lobby.DailyPlayer["score_best_entry"]["score"], Is.EqualTo(139));
                    Assert.That((ulong)daily.Lobby.DailyPlayer["theme_best_entry"]["objective_total"], Is.EqualTo(13));
                    Assert.That(daily.Run.Phase, Is.EqualTo("none"));
                    Assert.That(graph.Calls.Count(call => call.Operation == "accepted-entry"), Is.EqualTo(1));
                }
                int sent = graph.SubmittedCount;
                await flow.ObserveBoundRun(run);
                Assert.That(graph.SubmittedCount, Is.EqualTo(sent)); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [TestCase("daily")] public async Task PendingRerollReconcilesItsExactReceiptBeforeOracleDeliveryWithoutResending(string mode)
        {
            var graph = await Create(mode); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var launch = await Open(graph, flow); int sent = graph.SubmittedCount;
                graph.HoldNextConfirmation();
                var attempt = (await flow.SubmitRun(launch.Run, launch.Run.Binding.Accept(launch.Operation.State), RunClientAction.Reroll, 0, 0, 0, graph.Clock())).Value;
                Assert.That(attempt.Error, Is.TypeOf<RunExecutionException>(), attempt.Error?.ToString());
                Assert.That(attempt.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                var pending = await graph.Services.Journal.Load(graph.Owner); Assert.That(pending, Is.Not.Null);
                var stillPending = (await flow.RecoverRun(launch.Run)).Value;
                Assert.That(stillPending.Receipts.Single().Result.Signature, Is.EqualTo(pending.Signature));
                Assert.That(stillPending.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                graph.ConfirmPending();
                var recovered = (await flow.RecoverRun(launch.Run)).Value;
                Assert.That(recovered.Error, Is.Null, recovered.Error?.ToString());
                Assert.That(recovered.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(recovered.Receipts.Single().Result.Signature, Is.EqualTo(pending.Signature));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                await graph.DeliverNextOracle();
                var resolved = (await flow.ResolveRun(launch.Run)).Value;
                Assert.That(resolved.Error, Is.Null, resolved.Error?.ToString());
                Assert.That(NativeEngine.Summary(resolved.State.Token).ActionCounter, Is.EqualTo(1));
                Assert.That(graph.SubmittedCount, Is.EqualTo(sent + 1)); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [TestCase("daily")] public async Task SettlementRetryReconcilesDelayedCopybackBeforeSendingTheSingleConsume(string mode)
        {
            var graph = await Create(mode); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var run = await PlayToTerminal(graph, flow); graph.HoldCopyback();
                var pending = (await flow.SettleRun(run)).Value;
                Assert.That(pending.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                int sent = graph.SubmittedCount;
                graph.DeliverCopyback();
                var result = (await flow.SettleRun(run)).Value;
                Assert.That(result.Error, Is.Null, result.Error?.ToString());
                Assert.That(result.State.Phase, Is.EqualTo("consumed"));
                Assert.That(result.Receipts.Select(receipt => receipt.Result.Intent), Is.EqualTo(new[] { "commit-" + mode, "consume-" + mode }));
                Assert.That(result.Receipts.All(receipt => receipt.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                Assert.That(graph.SubmittedCount, Is.EqualTo(sent + 1));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [TestCase("daily")] public async Task SettlementRetryRetainsTheConfirmedConsumeAfterItsRunSlotDisappears(string mode)
        {
            var graph = await Create(mode); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var run = await PlayToTerminal(graph, flow); graph.HoldCopyback();
                await flow.SettleRun(run); graph.DeliverCopyback();
                var commit = (await flow.RecoverRun(run)).Value;
                Assert.That(commit.Error, Is.Null, commit.Error?.ToString());
                Assert.That(commit.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                graph.HoldNextConfirmation();
                var pending = (await flow.SettleRun(run)).Value;
                Assert.That(pending.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                var signature = pending.Receipts.Single().Result.Signature; int sent = graph.SubmittedCount;
                graph.ConfirmPending(); Assert.That(graph.Consumed, Is.True);
                var result = (await flow.SettleRun(run)).Value;
                Assert.That(result.Error, Is.Null, result.Error?.ToString());
                Assert.That(result.State.Phase, Is.EqualTo("consumed"));
                Assert.That(result.Receipts.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(result.Receipts.Single().Result.Signature, Is.EqualTo(signature));
                Assert.That(run.LastReceiptOperation, Is.SameAs(result));
                Assert.That(graph.SubmittedCount, Is.EqualTo(sent));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(await graph.Services.RunMarkers.Load(graph.Owner, mode), Is.Null);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
