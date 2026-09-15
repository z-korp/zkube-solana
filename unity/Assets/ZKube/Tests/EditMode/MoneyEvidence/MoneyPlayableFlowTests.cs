using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Client.Runs;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyPlayableFlowTests
    {
        private static Task<MoneyEvidenceGraph> Create() => MoneyEvidenceGraph.Create("owner-overview",
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [Test] public async Task SavedArcadeBindsItsAcceptedIdentityWithoutSigningOrStartingAnotherRun()
        {
            foreach (string mode in new[] { "daily" })
            {
                var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
                try
                {
                    await flow.Connect(); var launch = (await flow.OpenSavedRun(mode)).Value;
                    Assert.That(launch.CanBind, Is.True);
                    Assert.That(launch.Run.Owner, Is.EqualTo(graph.Owner)); Assert.That(launch.Run.Mode, Is.EqualTo(mode));
                    Assert.That(launch.Run.Address, Is.EqualTo(launch.Operation.State.Marker.ActiveRun));
                    Assert.That(launch.Operation.Receipts, Is.Empty);
                    var refreshed = (await flow.ObserveBoundRun(launch.Run)).Value;
                    Assert.That(refreshed.State.Token.State, Is.EqualTo(launch.Operation.State.Token.State));
                    Assert.That(graph.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
                    Assert.That(graph.ForbiddenCalls, Is.Zero);
                }
                finally { await flow.StopAsync(); }
            }
        }

        [Test] public async Task FreezeRejectsANewDailyActionBeforeAnyTransportOrSignerUse()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var launch = (await flow.OpenSavedRun("daily")).Value;
                int before = graph.Calls.Count;
                var result = (await flow.SubmitRun(launch.Run, launch.Operation.State.Token, RunClientAction.Reroll,
                    0, 0, 0, launch.Run.DeadlineAt)).Value;
                Assert.That(result.Error, Is.TypeOf<InvalidOperationException>());
                StringAssert.Contains("frozen", result.Error.Message);
                Assert.That(result.Receipts, Is.Empty); Assert.That(graph.Calls.Count, Is.EqualTo(before));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task ReconnectedOwnerCannotReuseAnEarlierVisibleRunHandle()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(); var run = (await flow.OpenSavedRun("daily")).Value.Run;
                await flow.Disconnect(); await flow.Connect(); int before = graph.Calls.Count;
                Assert.That(flow.RunIdentityCurrent(run), Is.False);
                try { await flow.ObserveBoundRun(run); Assert.Fail("Expected stale handle cancellation"); }
                catch (OperationCanceledException) { }
                Assert.That(graph.Calls.Count, Is.EqualTo(before)); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task OccupiedLocalCampaignCannotStartAnotherTrial()
        {
            var graph = await Create(); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect();
                var first = (await flow.StartCampaignRun(1, 1)).Value;
                try { await flow.StartCampaignRun(1, 1); Assert.Fail("Expected occupied local trial rejection"); }
                catch (InvalidOperationException) { }
                var resumed = (await flow.OpenSavedCampaign()).Value;
                Assert.That(resumed.View.RunId, Is.EqualTo(first.View.RunId));
                Assert.That(resumed.View.Token.State, Is.EqualTo(first.View.Token.State));
                Assert.That(graph.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
