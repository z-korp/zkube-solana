using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyDailyFlowTests
    {
        private static Task<MoneyEvidenceGraph> Create(string scenario = "owner-overview") => MoneyEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [Test] public async Task DailyReadShowsTheSavedRunWithoutSpendingOrRequestingSessionRepair()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var read = await flow.RefreshDaily();
                Assert.That(read.Value.Entry.Status, Is.EqualTo("resume"));
                Assert.That(read.Value.Entry.ResumeRunId, Is.EqualTo(read.Value.Run.Marker.RunId));
                Assert.That(read.Value.Lobby.DayId, Is.EqualTo(read.Value.Entry.DayId));
                Assert.That(read.Value.Lobby.Profile.Kredits, Is.EqualTo(read.Value.Entry.Kredits));
                var opened = (await flow.OpenSavedRun("daily")).Value;
                Assert.That(opened.CanBind, Is.True); Assert.That(opened.Operation.Receipts, Is.Empty);
                Assert.That(graph.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions" || call.Operation == "create-device"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task AProductReadDoesNotReconcileThePendingTransaction()
        {
            var graph = await Create("pending-confirmed-failure"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var before = await graph.Services.Journal.Load(graph.Owner);
                graph.ConfirmPendingFailure();
                var read = await flow.RefreshDaily();
                Assert.That(read.Value.Entry.Status, Is.EqualTo("pending-transaction"));
                var after = await graph.Services.Journal.Load(graph.Owner);
                Assert.That(after.Signature, Is.EqualTo(before.Signature));
                Assert.That(graph.Calls.Any(call => call.Operation == "getSignatureStatuses" || call.Operation == "sendTransaction"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task LocalCampaignReadDoesNotInvalidateDailyAndDisconnectInvalidatesBoth()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var first = await flow.RefreshDaily();
                var campaign = await flow.RefreshCampaign();
                Assert.That(first.IsCurrent, Is.True); Assert.That(campaign.IsCurrent, Is.True);
                var second = await flow.RefreshDaily();
                Assert.That(campaign.IsCurrent, Is.True); Assert.That(second.IsCurrent, Is.True);
                await flow.Disconnect(); Assert.That(second.IsCurrent, Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task CancelledDailyReadHasNoTransportOrNativeEffect()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); int before = graph.Calls.Count;
                using var cancel = new CancellationTokenSource(); cancel.Cancel();
                try { await flow.RefreshDaily(cancel.Token); Assert.Fail("Expected cancellation"); }
                catch (OperationCanceledException) { }
                Assert.That(graph.Calls.Count, Is.EqualTo(before)); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task StopDrainsALateDailyReadWithoutPublishingIt()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            var hold = graph.HoldNextRead("getMultipleAccounts");
            try
            {
                await flow.Connect(); var read = flow.RefreshDaily(); await hold.Entered;
                var stop = flow.StopAsync(); Assert.That(stop.IsCompleted, Is.False);
                hold.Release();
                try { await read; Assert.Fail("Expected cancellation"); }
                catch (OperationCanceledException) { }
                await stop; Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); await flow.StopAsync(); }
        }

        [TestCase("owner-overview", "resume")]
        [TestCase("public-disconnected", "missing-player")]
        [TestCase("pending-confirmed-failure", "pending-transaction")]
        public async Task DailyEntryRechecksItsCurrentGateBeforeAnySigning(string scenario, string expected)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect();
                try { await flow.StartDailyRun(); Assert.Fail("Expected entry gate rejection"); }
                catch (InvalidOperationException error) { StringAssert.Contains(expected, error.Message); }
                Assert.That(graph.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions" || call.Operation == "getSignatureStatuses"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task ArcadeLaunchGuardDoesNotGateLocalCampaign()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            var hold = graph.HoldNextRead("getMultipleAccounts");
            try
            {
                await flow.Connect(); var first = flow.StartDailyRun(); await hold.Entered;
                Assert.Throws<InvalidOperationException>(() => flow.StartDailyRun());
                Assert.That((await flow.StartCampaignRun(1, 1)).Value.View, Is.Not.Null);
                hold.Release();
                try { await first; Assert.Fail("Expected occupied Daily rejection"); }
                catch (InvalidOperationException error) { StringAssert.Contains("resume", error.Message); }
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); await flow.StopAsync(); }
        }
    }
}
