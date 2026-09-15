using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed class MoneyPlayableJourneyTests
    {
        private GameObject root, template, input;
        private TextAsset solana, session;
        private MoneyOverviewEvidenceHost evidence;

        [UnityTearDown] public IEnumerator Cleanup()
        {
            if (evidence != null) yield return MoneyOverviewTests.Wait(evidence.StopAsync());
            if (root != null) Object.Destroy(root);
            if (template != null) Object.Destroy(template);
            if (input != null) Object.Destroy(input);
            if (solana != null) Object.Destroy(solana);
            if (session != null) Object.Destroy(session);
            yield return null;
        }

        private IEnumerator Prepare(string scenario)
        {
            if (EventSystem.current == null) input = new GameObject("Playable input", typeof(EventSystem), typeof(StandaloneInputModule));
            template = new GameObject("Inactive playable template"); template.SetActive(false);
            var startup = template.AddComponent<MoneyStartup>();
            solana = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            session = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
            startup.Configure(solana, session, Resources.Load<TMP_FontAsset>("ZKube/Fonts/LilitaOne-Regular"),
                Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular"));
            root = new GameObject("Playable evidence"); root.SetActive(false);
            evidence = root.AddComponent<MoneyOverviewEvidenceHost>(); evidence.Configure(startup, scenario);
            root.SetActive(true);
            yield return Ready();
        }

        [UnityTest] public IEnumerator RaycastCampaignTrajectorySettlesThenShowsThreeSavedStars()
        {
            yield return Prepare("campaign-playable");
            yield return evidence.Click("Connect"); yield return evidence.Click("Campaign");
            yield return evidence.Click("Resume Campaign");
            var graph = evidence.PlayableGraph;
            var board = evidence.Active.GetComponent<MoneyBoardHost>().Board;
            Assert.That(board.Ready, Is.True);
            int inputs = 0;
            while (graph.NextInput != null && !graph.Consumed)
            {
                Assert.That(inputs++, Is.LessThan(30), "The finite trajectory must terminate");
                yield return evidence.PlayNextInput();
            }
            Assert.That(inputs, Is.GreaterThan(1));
            Assert.That(graph.Consumed, Is.True);
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.LevelComplete));
            Assert.That(board.State.Score, Is.EqualTo(10));
            StringAssert.Contains("Result saved.", string.Join("\n", board.GetComponentsInChildren<TMP_Text>().Select(value => value.text)));
            var journal = graph.Services.Journal.Load(graph.Owner); yield return MoneyOverviewTests.Wait(journal);
            Assert.That(journal.GetAwaiter().GetResult(), Is.Null);
            yield return evidence.Click("Dialog Continue");
            Assert.That(evidence.Active.Controller.PlayingRun, Is.False);
            StringAssert.Contains("★★★", string.Join("\n", evidence.Active.GetComponentsInChildren<TMP_Text>().Select(value => value.text)));
            // A new flow read deliberately supersedes the page's observation.
            // Verify the rendered return before making that separate read.
            var campaign = evidence.Active.Controller.Flow.RefreshCampaign(); yield return MoneyOverviewTests.Wait(campaign);
            Assert.That(campaign.GetAwaiter().GetResult().Value.Progress.TotalStars, Is.EqualTo(3));
            Assert.That(graph.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce()
        {
            yield return Prepare("daily-playable");
            yield return evidence.Click("Connect"); yield return evidence.Click("Daily");
            var graph = evidence.PlayableGraph;
            Assert.That(graph.SubmittedCount, Is.Zero);
            yield return evidence.Click("Enter · 1 Kredit");
            Assert.That(evidence.Active.Controller.ConfirmingDailyEntry, Is.True);
            Assert.That(graph.SubmittedCount, Is.Zero);
            yield return evidence.Click("Cancel entry");
            Assert.That(evidence.Active.Controller.ConfirmingDailyEntry, Is.False);
            Assert.That(graph.SubmittedCount, Is.Zero);
            yield return evidence.Click("Enter · 1 Kredit"); yield return evidence.Click("Confirm 1 Kredit");
            var board = evidence.Active.GetComponent<MoneyBoardHost>().Board;
            Assert.That(board.Ready, Is.True);
            Assert.That(board.Session.Daily, Is.True);
            Assert.That(graph.Calls.Count(call => call.Operation == "accepted-entry"), Is.EqualTo(1));
            int inputs = 0;
            while (graph.NextInput != null && !graph.Consumed)
            {
                Assert.That(inputs++, Is.LessThan(100), "The finite Daily trajectory must terminate");
                yield return evidence.PlayNextInput();
            }
            Assert.That(inputs, Is.EqualTo(85));
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.Finished));
            Assert.That(board.State.DailyScore, Is.EqualTo(139));
            Assert.That(board.State.ObjectiveTotal, Is.EqualTo(13));
            Assert.That(graph.Consumed, Is.True);
            StringAssert.Contains("Result saved.", string.Join("\n", board.GetComponentsInChildren<TMP_Text>().Select(value => value.text)));
            var journal = graph.Services.Journal.Load(graph.Owner); yield return MoneyOverviewTests.Wait(journal);
            Assert.That(journal.GetAwaiter().GetResult(), Is.Null);
            yield return evidence.Click("Dialog Continue");
            Assert.That(evidence.Active.Controller.PlayingRun, Is.False);
            Assert.That(evidence.Active.Controller.BrowsingDaily, Is.True);
            var daily = evidence.Active.Controller.Flow.RefreshDaily(); yield return MoneyOverviewTests.Wait(daily);
            var result = daily.GetAwaiter().GetResult().Value;
            Assert.That(result.Lobby.Profile.Kredits, Is.EqualTo(24));
            Assert.That(result.Lobby.Profile.LadderPoints, Is.EqualTo(200));
            Assert.That((uint)result.Lobby.DailyPlayer["score_best_entry"]["score"], Is.EqualTo(139));
            Assert.That((ulong)result.Lobby.DailyPlayer["theme_best_entry"]["objective_total"], Is.EqualTo(13));
            Assert.That(graph.Calls.Count(call => call.Operation == "accepted-entry"), Is.EqualTo(1));
            Assert.That(graph.ForbiddenCalls, Is.Zero);
        }

        private IEnumerator Ready()
        {
            float until = Time.realtimeSinceStartup + 20;
            while (!evidence.Ready && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(evidence.Ready, Is.True, evidence.ReadinessJson());
        }
    }
}
