using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyClaimEvidenceTests
    {
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "../../fixtures/unity-money-claims-v1.json")));
        private static Task<MoneySessionEvidenceGraph> Create(string scenario) => MoneySessionEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
        private static PrizeBoard Chosen(DailyBoards boards, string kind) => kind == "score" ? boards.Score : boards.Theme;
        private static void Boards(DailyBoards actual, JToken expected)
        {
            foreach (var board in new[] { actual.Score, actual.Theme })
            {
                var source = expected.Single(row => (string)row["kind"] == board.Kind);
                // The existing ProductRead agreement distinguishes an allocated,
                // unsealed board from TS's coarser frozen lifecycle status.
                // Bind both to the validated header rather than changing either API.
                if (!board.Account.Sealed)
                {
                    Assert.That((string)source["status"], Is.EqualTo("frozen"));
                    Assert.That(board.Status, Is.EqualTo("unsealed"));
                    Assert.That(board.ClaimStatus, Is.EqualTo("unsealed"));
                }
                else Assert.That(board.Status, Is.EqualTo((string)source["status"]));
                Assert.That(board.Rows.Count, Is.EqualTo(source["rows"].Count()));
                for (int i = 0; i < board.Rows.Count; i++)
                {
                    var row = board.Rows[i]; var reference = source["rows"][i];
                    Assert.That(row.Record.Player, Is.EqualTo((string)reference["address"]));
                    Assert.That(row.Rank, Is.EqualTo((uint)reference["rank"]));
                    Assert.That(row.Metric.ToString(), Is.EqualTo((string)reference["metric"]));
                    Assert.That(row.PayoutLamports.ToString(), Is.EqualTo((string)reference["payoutLamports"]));
                }
            }
        }

        [TestCase("claim-score-sealed"), TestCase("claim-theme-sealed"),
         TestCase("claim-score-deadline"), TestCase("claim-theme-deadline"),
         TestCase("claim-score-expired"), TestCase("claim-theme-expired"),
         TestCase("claim-score-claims-expired"), TestCase("claim-theme-claims-expired"),
         TestCase("claim-score-unsealed"), TestCase("claim-theme-unsealed"),
         TestCase("claim-score-claimed"), TestCase("claim-theme-claimed"),
         TestCase("claim-score-missing-session"), TestCase("claim-theme-missing-session"),
         TestCase("claim-score-pending-success"), TestCase("claim-theme-pending-success"),
         TestCase("claim-score-pending-failure"), TestCase("claim-theme-pending-failure")]
        public async Task EachClaimUsesTheDeviceExactMessageAndConfirmedBoardAndProfile(string scenario)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var row = Fixture()["scenarios"].Single(value => (string)value["id"] == scenario);
                await flow.Connect(graph.Owner);
                var initial = (await flow.RefreshRewards(graph.ClaimDay)).Value;
                var before = initial.Profile;
                var boards = initial.Boards;
                Assert.That(initial.Session.Current, Is.EqualTo((string)row["variant"] != "missing-session"));
                Assert.That(graph.Calls.Any(call => call.Operation == "getSignatureStatuses" || call.Operation == "signTransactions"), Is.False);
                Boards(boards, row["expectedBefore"]["boards"]);
                string variant = (string)row["variant"];
                var chosen = Chosen(boards, graph.ClaimKind);
                var peer = Chosen(boards, graph.ClaimKind == "score" ? "theme" : "score");
                Assert.That(peer.ClaimStatus, Is.EqualTo(variant == "claims-expired" ? "expired" : "claimable"));
                if (variant == "claims-expired") Assert.That(chosen.ClaimStatus, Is.EqualTo("expired"));
                if (variant == "expired")
                {
                    Assert.That(chosen.ClaimStatus, Is.EqualTo("expired"));
                    Assert.That(chosen.ExpiresAt, Is.LessThan(graph.Clock()));
                    Assert.That(peer.ExpiresAt, Is.GreaterThan(graph.Clock()));
                }
                if (variant == "deadline") Assert.That(chosen.ExpiresAt, Is.EqualTo(graph.Clock()));
                bool available = variant == "sealed" || variant == "deadline";
                if (!available)
                {
                    await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind));
                    Assert.That(graph.SentSignature, Is.Null);
                    Assert.That(graph.Calls.Any(call => call.Operation == "getLatestBlockhash"), Is.False);
                }
                else
                {
                    Assert.That(chosen.ClaimStatus, Is.EqualTo("claimable"));
                    Assert.That(chosen.Yours.PayoutLamports.ToString(), Is.EqualTo((string)row["amountLamports"]));
                    var receipt = (await flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind)).Value;
                    string original = receipt.Signature;
                    if ((string)row["status"] == "processed")
                    {
                        Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending), receipt.Code);
                        int statusCalls = graph.Calls.Count(call => call.Operation == "getSignatureStatuses");
                        var pending = (await flow.RefreshRewards(graph.ClaimDay)).Value;
                        Assert.That(pending.Profile.LadderPoints, Is.EqualTo(before.LadderPoints));
                        Assert.That(pending.Pending.Signature, Is.EqualTo(original));
                        Assert.That(graph.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(statusCalls));
                        await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind));
                        if ((bool)row["failure"]) graph.ConfirmPendingFailure(); else graph.ConfirmPendingSuccess();
                        receipt = (await flow.ResumePending()).Value;
                    }
                    Assert.That(receipt.Outcome, Is.EqualTo((bool)row["failure"] ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess), receipt.Code);
                    Assert.That(receipt.Signature, Is.EqualTo(original));
                    Assert.That(receipt.Signature, Is.EqualTo(graph.SentSignature));
                    Assert.That((await flow.RefreshKredits()).Value.PreviousOperation, Is.SameAs(receipt));
                    var calls = graph.Calls.Select(call => call.Operation).ToList();
                    Assert.That(calls.Count(call => call == "sendTransaction"), Is.EqualTo(1));
                    Assert.That(calls.IndexOf("commit-journal"), Is.LessThan(calls.IndexOf("sendTransaction")));
                }
                var final = (await flow.RefreshRewards(graph.ClaimDay)).Value;
                var after = final.Profile;
                Assert.That(after.LadderPoints.ToString(), Is.EqualTo((string)row["expectedAfter"]["ladderPoints"]));
                Assert.That(after.LadderPoints - before.LadderPoints, Is.EqualTo(available && !(bool)row["failure"] ? (ulong)row["points"] : 0UL));
                Assert.That(after.Kredits, Is.EqualTo(before.Kredits));
                Assert.That(after.HighestTier, Is.EqualTo((byte)row["expectedAfter"]["highestTier"]));
                foreach (string field in new[] { "lifetime_paid_entries", "campaign_stars", "entry_streak_days" })
                    Assert.That(JToken.DeepEquals(after.Fields[field], before.Fields[field]), Is.True, field);
                var finalBoards = final.Boards;
                Boards(finalBoards, row["expectedAfter"]["boards"]);
                Assert.That(Chosen(finalBoards, graph.ClaimKind == "score" ? "theme" : "score").ClaimStatus,
                    Is.EqualTo(variant == "claims-expired" ? "expired" : "claimable"));
                if (available && !(bool)row["failure"])
                {
                    Assert.That(Chosen(finalBoards, graph.ClaimKind).ClaimStatus, Is.EqualTo("claimed"));
                    await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind));
                    Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                }
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.HasCandidateKey, Is.False);
                Assert.That(graph.HasActiveKey, Is.EqualTo(variant != "missing-session"));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [TestCase("claim-score-sealed"), TestCase("claim-theme-sealed")]
        public async Task CollectingOneBoardDoesNotReadTheUnavailablePeer(string scenario)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(graph.Owner); graph.RejectClaimPeerReads();
                var receipt = (await flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind)).Value;
                Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), receipt.Code);
                Assert.That(graph.Calls.Any(call => call.Operation == "injected-unavailable-peer-board"), Is.False);
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task ConfirmedClaimSurvivesReadbackFailureWithoutRepeatingPayment()
        {
            var graph = await Create("claim-score-sealed"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(graph.Owner); graph.FailFirstReadAfterJournalClear();
                var result = (await flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind)).Value;
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                await MoneyTestEnvironment.Fails<IOException>(() => flow.RefreshRewards(graph.ClaimDay));
                var recovered = (await flow.RefreshRewards(graph.ClaimDay)).Value;
                Assert.That(recovered.PreviousOperation, Is.SameAs(result));
                Assert.That(recovered.Profile.LadderPoints, Is.EqualTo(370));
                Assert.That(recovered.Boards.Score.ClaimStatus, Is.EqualTo("claimed"));
                Assert.That(recovered.Boards.Theme.ClaimStatus, Is.EqualTo("claimable"));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task DisconnectDuringClaimPreflightCannotSubmitUnderThePreviousOwner()
        {
            var graph = await Create("claim-theme-sealed"); var flow = new MoneyAppFlow(graph.Services);
            var held = graph.HoldNextRead("getMultipleAccounts");
            try
            {
                await flow.Connect(graph.Owner); var claim = flow.ClaimDaily(graph.ClaimDay, graph.ClaimKind); await held.Entered;
                var disconnect = flow.Disconnect(); Assert.That(graph.Services.Identity.Owner, Is.Null); held.Release();
                await MoneyTestEnvironment.Fails<OperationCanceledException>(() => claim); await disconnect;
                Assert.That(graph.SentSignature, Is.Null);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(graph.Calls.Any(call => call.Operation == "signTransactions"), Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); await flow.StopAsync(); }
        }

        [Test] public async Task RewardReadCannotPublishAcrossDisconnect()
        {
            var graph = await Create("claim-score-sealed"); var flow = new MoneyAppFlow(graph.Services);
            var held = graph.HoldNextRead("getMultipleAccounts");
            try
            {
                await flow.Connect(graph.Owner); var read = flow.RefreshRewards(graph.ClaimDay); await held.Entered;
                var disconnect = flow.Disconnect(); held.Release();
                await MoneyTestEnvironment.Fails<OperationCanceledException>(() => read); await disconnect;
                Assert.That(graph.SentSignature, Is.Null);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); await flow.StopAsync(); }
        }
    }
}
