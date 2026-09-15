using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyEvidenceGraphTests
    {
        private static string Schema(string name) => File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/" + name + ".json"));
        private static JObject Fixture(string name) => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-" + name + "-v1.json"))));
        private static Task<MoneyEvidenceGraph> Create(string name) => MoneyEvidenceGraph.Create(name, Schema("solana"), Schema("session"));
        private static async Task<T> Fails<T>(Func<Task> call) where T : Exception
        { try { await call(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }

        [TestCase("public-disconnected")]
        [TestCase("owner-overview")]
        [TestCase("pending-confirmed-failure")]
        public async Task EveryScenarioBeginsDisconnectedAndPublicReadNeverTouchesNativeOrOwnerStore(string name)
        {
            var graph = await Create(name); Assert.That(graph.Services.Identity.Owner, Is.Null);
            var before = graph.Calls.Count; var flow = new MoneyAppFlow(graph.Services);
            var result = (await flow.RefreshPublic()).Value;
            Assert.That(result.HasPublication, Is.True); Assert.That(result.DayId, Is.EqualTo((uint)Fixture("product-reads")["inputs"]["day"]));
            Assert.That(result.ObservedAt, Is.EqualTo(graph.Clock()));
            Assert.That(graph.Calls.Skip(before).Select(c => c.Boundary), Is.All.EqualTo("base"));
            Assert.That(graph.Calls.Skip(before).Select(c => c.Operation), Is.EqualTo(new[] { "getGenesisHash", "getMultipleAccounts" }));
            Assert.That(graph.SourceSha256.Length, Is.EqualTo(64)); Assert.That(graph.Label, Does.StartWith("Offline evidence"));
            Assert.That(graph.ForbiddenCalls, Is.Zero); await flow.StopAsync();
        }
        [Test]
        public async Task OwnerScenarioUsesActualAcceptedNativeTokensAndSeparateSlotsWithoutSessionCreation()
        {
            var graph = await Create("owner-overview"); var flow = new MoneyAppFlow(graph.Services); await flow.Connect();
            var state = (await flow.RefreshOwner()).Value; var oracle = Fixture("run-client");
            var expected = Fixture("money-overview")["expectedProfile"];
            Assert.That(state.Owner, Is.EqualTo(graph.Owner)); Assert.That(state.Profile.Kredits.ToString(), Is.EqualTo((string)expected["kredits"]));
            Assert.That(state.Profile.LadderPoints.ToString(), Is.EqualTo((string)expected["ladderPoints"]));
            Assert.That(state.Profile.CurrentTier, Is.EqualTo((byte)expected["ladderTier"]));
            Assert.That(state.Profile.CurrentTier, Is.EqualTo(ZKube.Core.NativeEngine.LadderTier(state.Profile.LadderPoints)));
            Assert.That(state.Profile.HighestTier, Is.EqualTo((byte)expected["highestTier"]));
            Assert.That(state.Profile.HighestTier, Is.GreaterThanOrEqualTo(state.Profile.CurrentTier));
            Assert.That(state.Profile.WornTier, Is.EqualTo((byte)expected["wornBorder"]));
            var fields = state.Profile.Fields;
            Assert.That((uint)fields["entry_streak_days"], Is.EqualTo((uint)expected["streak"]));
            Assert.That((uint)fields["best_daily_score"], Is.EqualTo((uint)expected["bestScore"]));
            Assert.That((uint)fields["last_entry_day_id"], Is.EqualTo((uint)expected["lastEntryDayId"]));
            Assert.That((byte)fields["featured_emblem"], Is.EqualTo((byte)expected["wornEmblem"]));
            Assert.That(((ulong)fields["lifetime_paid_entries"]).ToString(), Is.EqualTo((string)expected["lifetimePaidEntries"]));
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields[kind + "_record"]; var wanted = expected["records"][kind];
                Assert.That((uint)record["best_prize_rank"], Is.EqualTo((uint)wanted["bestPrizeRank"]));
                Assert.That((uint)record["podiums"], Is.EqualTo((uint)wanted["podiums"]));
                Assert.That((uint)record["wins"], Is.EqualTo((uint)wanted["wins"]));
                Assert.That(((ulong)record["rewards_lamports"]).ToString(), Is.EqualTo((string)wanted["rewardsLamports"]));
            }
            var campaign = (await graph.Services.Products.Campaign()).Value;
            CollectionAssert.AreEqual(expected["stars"].Values<byte>(), campaign.Maps.SelectMany(map => map.Stars));
            foreach (var map in campaign.Maps)
            {
                var wanted = expected["campaign"].Single(row => (byte)row["mapId"] == map.MapId);
                Assert.That(map.Unlocked, Is.EqualTo((bool)wanted["unlocked"]));
                Assert.That(map.Cleared, Is.EqualTo((bool)wanted["cleared"]));
                Assert.That(map.Perfected, Is.EqualTo((bool)wanted["perfected"]));
            }
            var activeMap = campaign.Maps.Single(map => map.MapId == (byte)expected["activeCampaign"]["mapId"]);
            Assert.That(activeMap.Unlocked, Is.True);
            int activeLevel = (int)expected["activeCampaign"]["level"];
            Assert.That(activeLevel, Is.InRange(1, activeMap.Stars.Count));
            if (activeLevel > 1) Assert.That(activeMap.Stars[activeLevel - 2], Is.GreaterThan(0));
            Assert.That(state.Session.Status, Is.EqualTo("none"));
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var actual = mode == "campaign" ? state.Campaign : state.Daily;
                var row = oracle["cases"].Single(x => (string)x["id"] == "active-" + mode + "-playing");
                Assert.That(actual.Phase, Is.EqualTo("delegated"));
                CollectionAssert.AreEqual(Convert.FromBase64String((string)row["token"]["state"]), actual.Token.State);
                Assert.That(actual.Marker.ActiveRun, Is.EqualTo((string)row["address"]));
            }
            var retained = graph.Calls; await flow.Disconnect(); Assert.That(graph.Calls.Count, Is.GreaterThan(retained.Count));
            Assert.That(retained.Any(c => c.Operation == "disconnect"), Is.False, "Call reports must be immutable snapshots");
            Assert.That(graph.Services.Identity.Owner, Is.Null); Assert.That(graph.ForbiddenCalls, Is.Zero); await flow.StopAsync();
        }
        [Test]
        public async Task ProcessedErrorStaysPendingUntilExplicitFixtureAdvanceAndThenReturnsConfirmedFailure()
        {
            var graph = await Create("pending-confirmed-failure"); var flow = new MoneyAppFlow(graph.Services); await flow.Connect();
            var first = (await flow.RefreshOwner()).Value; var signature = first.Pending.Signature;
            Assert.That(first.PreviousOperation.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(first.Profile, Is.Null);
            Assert.That((await flow.ResumePending()).Value.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            graph.ConfirmPendingFailure(); var receipt = (await flow.ResumePending()).Value;
            Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure), receipt.Code);
            Assert.That(receipt.Signature, Is.EqualTo(signature)); Assert.That(receipt.ChainError, Is.Not.Null);
            Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
            var owner = (await flow.RefreshOwner()).Value;
            Assert.That(owner.Profile.Exists, Is.True); Assert.That(owner.Pending, Is.Null);
            Assert.That(owner.PreviousOperation, Is.SameAs(receipt), "A cleared journal must not erase the confirmed outcome from later owner reads");
            Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure), "Receipt stays explicit after a later owner read");
            Assert.That(graph.ForbiddenCalls, Is.Zero); await flow.StopAsync();
        }
        [Test]
        public async Task DelayedCallbackCannotPublishAfterCancellationAndNextReadStillWorks()
        {
            var graph = await Create("public-disconnected"); var flow = new MoneyAppFlow(graph.Services);
            var hold = graph.HoldNextRead("getMultipleAccounts"); using var cancel = new CancellationTokenSource();
            var pending = flow.RefreshPublic(cancel.Token); await hold.Entered; cancel.Cancel(); hold.Release();
            await Fails<OperationCanceledException>(async () => await pending); Assert.That(flow.Public, Is.Null);
            Assert.That((await flow.RefreshPublic()).Value.HasPublication, Is.True); Assert.That(graph.ForbiddenCalls, Is.Zero); await flow.StopAsync();
        }
        [Test]
        public async Task ForbiddenOperationsFailInsteadOfSimulatingAPlayablePaidSuccess()
        {
            var graph = await Create("owner-overview"); var flow = new MoneyAppFlow(graph.Services); await flow.Connect();
            await Fails<InvalidOperationException>(async () => await flow.EnsureSession());
            Assert.That(graph.ForbiddenCalls, Is.GreaterThan(0)); Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
            int count = graph.ForbiddenCalls;
            await Fails<InvalidOperationException>(async () => await graph.Services.Rpc.LatestBlockhash(graph.Services.Rpc.Base));
            Assert.That(graph.ForbiddenCalls, Is.EqualTo(count + 1));
            var signed = (string)Fixture("solana")["transactions"].Single(row => (string)row["id"] == "purchase-1")["signedTransaction"];
            await Fails<InvalidOperationException>(async () => await graph.Services.Wallet.Sign(graph.Owner, Convert.FromBase64String(signed)));
            Assert.That(graph.ForbiddenCalls, Is.EqualTo(count + 2), "An existing signed oracle cannot enable a new wallet signing request");
            Assert.Throws<ArgumentException>(() => graph.HoldNextRead("sendTransaction"));
            Assert.Throws<InvalidOperationException>(() => graph.ConfirmPendingFailure()); await flow.StopAsync();
        }
        [Test]
        public async Task SharedEvidenceClockUsesActualFreezeAndMissingNextDayPublication()
        {
            var graph = await Create("public-disconnected"); var flow = new MoneyAppFlow(graph.Services);
            var initial = (await flow.RefreshPublic()).Value;
            Assert.That(initial.Status, Is.EqualTo("open"));
            graph.AdvanceClock(initial.FreezesAt.Value - graph.Clock());
            Assert.That((await flow.RefreshPublic()).Value.Status, Is.EqualTo("frozen"));
            graph.AdvanceClock(86400 - graph.Clock() % 86400);
            var next = (await flow.RefreshPublic()).Value;
            Assert.That(next.DayId, Is.EqualTo(initial.DayId + 1)); Assert.That(next.Status, Is.EqualTo("missing-daily"));
            Assert.That(next.PotLamports, Is.Null); Assert.That(next.HasPublication, Is.False);
            Assert.Throws<ArgumentOutOfRangeException>(() => graph.AdvanceClock(0));
            Assert.That(graph.ForbiddenCalls, Is.Zero); await flow.StopAsync();
        }
        [Test]
        public async Task UnknownScenarioAndMalformedSchemasCannotFallBackToUsableEvidence()
        {
            await Fails<ArgumentException>(async () => await Create("production"));
            await Fails<Exception>(async () => await MoneyEvidenceGraph.Create("owner-overview", "{}", Schema("session")));
        }
    }
}
