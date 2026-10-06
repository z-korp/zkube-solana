using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator RaycastCampaignPlaysLocallyWithoutDeviceSetup()
        {
            yield return PrepareScenario("campaign-playable");
            yield return SessionClick("Connect"); yield return Idle();
            yield return SessionClick("Campaign"); yield return Idle();
            // From the drawn map on, no page change shows the clear colour.
            var watch = ZKube.Tests.Presentation.PaintWatch.On(host.GetComponent<PageShell>());
            yield return SessionClick("Trial 1"); yield return Idle();
            watch.Step = "the board"; yield return SessionClick("Play");
            yield return BoardReady();
            var board = PlayedBoard();
            Assert.That(board.Session.Daily, Is.False);
            Click("Reroll action"); yield return null; Click("Dialog " + BoardController.RerollConfirm); yield return BoardAccepted(1);
            Click("Pause"); yield return null;
            Click("Dialog End run"); yield return null;
            Click("Dialog End run"); yield return BoardFinished();
            // The ended run opens its result, then its map, as in Realms.
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            float until = Time.realtimeSinceStartup + 15;
            while (host.GetComponent<PageViews>().Shown != AppPage.Result && Time.realtimeSinceStartup < until) yield return null;
            yield return Idle();
            Assert.That(controller.PlayingRun, Is.False);
            StringAssert.Contains("Run ended", SessionText());
            // The result's stars play under a tap-to-skip layer: the map is reached once they have.
            foreach (var sequence in host.GetComponentsInChildren<PageSequence>()) sequence.Finish();
            yield return null;
            watch.Step = "the map"; yield return SessionClick("Map"); yield return Idle();
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Campaign));
            watch.AssertCovered(); watch.Stop();
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
        }

        [UnityTest] public IEnumerator DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arena");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(environment.SentSignature, Is.Null);
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.True);
            Assert.That(environment.SentSignature, Is.Null);
            yield return SessionClick("Cancel entry"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.False);
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            // From the Arcade into the board and back, no frame shows the clear colour.
            var watch = ZKube.Tests.Presentation.PaintWatch.On(host.GetComponent<PageShell>()); watch.Step = "the Daily's board";
            // The best to beat is the lobby's, read before the run opened.
            var profile = ((ZKube.Integration.Client.MoneyRead<MoneyDailyState>)typeof(MoneyAppAdapter).GetField("dailyRead",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(controller)).Value.Lobby.Profile.Fields;
            yield return SessionClick("Confirm 1 Kredit"); yield return Idle();
            yield return BoardReady();
            var board = host.GetComponent<MoneyBoardHost>().Board;
            Assert.That(board.Session.Daily, Is.True);
            Assert.That(board.Session.DailyFacts.Best, Is.EqualTo((ulong)(uint)profile["best_daily_score"]));
            // The crown is the day's Score board top, read once as the run opened.
            Assert.That(board.Session.DailyFacts.Top, Is.Not.Null);
            yield return Wait(board.Session.DailyFacts.Top); yield return null;
            Assert.That(board.View.CrownShown, Is.EqualTo(CrownBadge.State(CrownBadge.Top(board.Session.DailyFacts.Top), board.State.DailyScore)));
            Click("Reroll action"); yield return null; Click("Dialog " + BoardController.RerollConfirm); yield return BoardAccepted(1);
            Click("Pause"); yield return null;
            Click("Dialog End run"); yield return null;
            Click("Dialog End run"); yield return BoardFinished();
            var rust = environment.Runs["cases"].Single(row => (string)row["id"] == "active-daily-finished");
            var token = new ZKube.Core.CoreRunToken(System.Convert.FromBase64String((string)rust["token"]["config"]),
                System.Convert.FromBase64String((string)rust["token"]["state"]));
            var expected = ZKube.Core.NativeEngine.Summary(token);
            Assert.That(board.State.DailyScore, Is.EqualTo(expected.DailyScore));
            Assert.That(board.State.ObjectiveTotal, Is.EqualTo(expected.ObjectiveTotal));
            // The ended run opens its result by itself, as a Realms run does: no
            // dialog stands in between and nothing is tapped. Its result is saved behind the page.
            watch.Step = "the Daily's result";
            float until = Time.realtimeSinceStartup + 15;
            while ((host.GetComponent<PageViews>().Shown != AppPage.Result || !environment.Consumed) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Result));
            Assert.That(environment.Consumed, Is.True);
            yield return Until(() => Says(MoneyBoardHost.SavedNotice), "The result says it is saved"); yield return Idle();
            var journal = environment.Services.Journal.Load(environment.Owner); yield return Wait(journal);
            Assert.That(journal.GetAwaiter().GetResult(), Is.Null);
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(host.GetComponentsInChildren<BoardController>(true), Is.Empty, "The board has left");
            watch.AssertCovered(); watch.Stop();
            Assert.That(controller.ResultPage().HasResult, Is.True);
            // The guardian speaks of this run, which scored nothing, and the streak
            // the entry changed is read once the result is saved.
            var realm = PageCatalog.Load().Realm(controller.ResultPage().Realm);
            Assert.That(controller.ResultPage().Speaks, Is.EqualTo(TalkMoment.Win)); Assert.That(controller.ResultPage().NewBest, Is.False);
            StringAssert.Contains(realm.guardianLines.Stars(1), SessionText()); StringAssert.DoesNotContain(realm.guardianLines.dailyGreeting, SessionText());
            yield return Until(() => controller.ResultPage().Streak != null, "The streak is read after the result is saved"); yield return Idle();
            Assert.That(controller.ResultPage().Score, Is.EqualTo(expected.DailyScore));
            Assert.That(controller.ResultPage().ObjectiveTotal, Is.EqualTo(expected.ObjectiveTotal));
            // The Arena's result names the two boards the run counts on and when
            // places become final; Continue leads, with Share beside it and the boards under them.
            var arcade = SessionText();
            StringAssert.Contains("Daily run complete", arcade); StringAssert.Contains("Score board", arcade);
            StringAssert.Contains("Your best run counts", arcade);
            StringAssert.Contains("Places are final when each board is sealed after the day closes at 07:00 UTC.", arcade);
            Assert.That(Find("Continue").GetComponent<UnityEngine.UI.Image>().sprite.name, Does.StartWith(ZKube.Core.Generated.SkinSlots.ButtonPrimary));
            var shell = host.GetComponent<PageShell>();
            foreach (var (phone, name) in new (System.Action<PageShell>, string)[] {
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker"), (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640") })
            {
                phone(shell);
                try
                {
                    controller.Navigate(AppPage.Result); yield return Idle();
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, name + " arcade result");
                    ZKube.Tests.Presentation.Placement.Check(host.transform, shell.SafeArea, 1, name + " arcade result");
                    var bubble = host.GetComponentsInChildren<UnityEngine.UI.Image>().Single(image => image.name == "Guardian bubble");
                    var card = host.GetComponentsInChildren<UnityEngine.UI.Image>().Single(image => image.name == "Screen card");
                    Assert.That(SkinUi.ScreenRect(bubble.rectTransform).yMin, Is.GreaterThanOrEqualTo(SkinUi.ScreenRect(card.rectTransform).yMax - .5f),
                        name + ": the bubble stays above the card");
                    foreach (var button in new[] { Find("Continue"), Find("Share"), Find("See boards") })
                    {
                        var rect = SkinUi.ScreenRect((RectTransform)button.transform);
                        Assert.That(rect.height, Is.GreaterThanOrEqualTo(48 - .01f), name + ": " + button.name + " is 48 dp to touch");
                        Assert.That(rect.yMin >= shell.SafeArea.yMin - .5f && rect.yMax <= shell.SafeArea.yMax + .5f, Is.True, name + ": " + button.name + " is on screen");
                    }
                    foreach (var text in host.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)))
                    {
                        var rect = SkinUi.ScreenRect(text.rectTransform);
                        Assert.That(text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity).y, Is.LessThanOrEqualTo(rect.height + .5f), name + ": '" + text.text + "' fits");
                    }
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
            controller.Navigate(AppPage.Result); yield return Idle();
            yield return SessionClick("Share"); yield return null;
            StringAssert.StartsWith(Application.productName + " · Daily", GUIUtility.systemCopyBuffer);
            // The way back is the landing page, where the next entry is offered.
            yield return SessionClick("Continue"); yield return Idle();
            Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(host.GetComponent<MoneyBoardHost>().HasRun, Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The day closes on a run still on its board: no dialog, the run ends at
        // its last accepted state, its result opens and is saved, and the way
        // back is open. Nothing asks the player to check anything.
        [UnityTest] public IEnumerator ARunTheDayClosesOnOpensItsResultAndIsSaved()
        {
            yield return PrepareScenario("daily-entered"); Click("Connect"); yield return Idle();
            yield return SessionClick("Resume run"); yield return BoardReady();
            var board = PlayedBoard(); uint score = board.State.DailyScore;
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.Playing));
            environment.AdvanceClock(board.Session.DailyFacts.ClosesAt - environment.Clock());
            yield return Until(() => host.GetComponent<PageViews>().Shown == AppPage.Result && Says(MoneyBoardHost.SavedNotice), "The closed day's run opened its result and saved it");
            yield return Idle();
            Assert.That(environment.Consumed, Is.True);
            Assert.That(host.GetComponentsInChildren<BoardController>(true), Is.Empty);
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.ResultPage().Score, Is.EqualTo(score), "The run counts at its last accepted state");
            Assert.That(Find("Continue").interactable, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        // A run nobody resolved stands in the slot. Until its recovery deadline
        // the landing page offers to resume it; after it, the run can no longer
        // score, the next entry retires it, and Resume is not what stands there.
        [UnityTest] public IEnumerator ARunPastItsRecoveryDeadlineNoLongerStandsInTheWayOfTheNextEntry()
        {
            yield return PrepareScenario("daily-entered"); Click("Connect"); yield return Idle();
            Assert.That(Offers("Resume run"), Is.True);
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            var run = ((ZKube.Integration.Client.MoneyRead<MoneyDailyState>)typeof(MoneyAppAdapter).GetField("dailyRead",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(controller)).Value.Run;
            long deadline = new ZKube.Integration.ActiveRunReconciler(environment.Services.Accounts).DeadlineAt(run.Account, environment.Owner);
            long recovery = deadline + (long)ZKube.Core.Generated.Protocol.RunRecoverySeconds;
            environment.AdvanceClock(recovery - 1 - environment.Clock());
            yield return Wait(controller.RefreshOverview()); yield return Idle();
            Assert.That(Offers("Resume run"), Is.True, "Still recoverable: the run is resumed, and ends by the Deadline rule");
            environment.AdvanceClock(1);
            yield return Wait(controller.RefreshOverview()); yield return Idle();
            Assert.That(Offers("Resume run"), Is.False, "Past recovery the run is retired by the next entry");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        // A result that could not be saved says so on its page and is asked for
        // again there; the boards are the way out while it is not. Saved, the
        // way back opens.
        [UnityTest] public IEnumerator AResultThatIsNotSavedYetSaysSoOnItsPageAndIsSavedFromThere()
        {
            yield return PrepareScenario("daily-entered"); Click("Connect"); yield return Idle();
            yield return SessionClick("Resume run"); yield return BoardReady();
            environment.RefuseNextRunAction("consume_arena_run");
            Click("Pause"); yield return null; Click("Dialog End run"); yield return null; Click("Dialog End run");
            yield return Until(() => host.GetComponent<PageViews>().Shown == AppPage.Result && Says(MoneyBoardHost.UnsavedNotice), "The result says it is not saved yet");
            yield return Idle();
            Assert.That(environment.Consumed, Is.False);
            Assert.That(Offers("Try again"), Is.True); Assert.That(Offers("Continue"), Is.False);
            Assert.That(Find("See boards").interactable, Is.True, "The boards are the way out");
            StringAssert.Contains("Daily run complete", SessionText());
            yield return SessionClick("Try again");
            yield return Until(() => Says(MoneyBoardHost.SavedNotice), "The result is saved"); yield return Idle();
            Assert.That(environment.Consumed, Is.True);
            Assert.That(Offers("Try again"), Is.False);
            yield return SessionClick("Continue"); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.BrowsingDaily, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The board playing: an Arcade run's, or the run board's Campaign run.
        private BoardController PlayedBoard() => host.GetComponent<MoneyBoardHost>()?.Board ?? host.GetComponent<RunBoard>()?.Board;
        private IEnumerator BoardReady()
        {
            float until = Time.realtimeSinceStartup + 15;
            while (ZKube.Tests.Presentation.BoardTestState.Idle(PlayedBoard()) != true && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(PlayedBoard()), Is.True);
        }
        private IEnumerator BoardAccepted(uint count)
        {
            var board = PlayedBoard();
            float until = Time.realtimeSinceStartup + 15;
            while (board.State.ActionCounter != count && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(board.State.ActionCounter, Is.EqualTo(count));
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) && Time.realtimeSinceStartup < until) yield return null;
            yield return null;
        }
        private IEnumerator BoardFinished()
        {
            var board = PlayedBoard();
            float until = Time.realtimeSinceStartup + 15;
            while (board.State.Phase != (byte)CorePhase.Finished && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.Finished));
            yield return null;
        }
    }
}
