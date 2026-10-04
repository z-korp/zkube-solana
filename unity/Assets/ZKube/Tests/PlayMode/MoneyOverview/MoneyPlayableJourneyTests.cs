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
            yield return SessionClick("Trial 1"); yield return Idle();
            yield return SessionClick("Play");
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
            yield return SessionClick("Map"); yield return Idle();
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Campaign));
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
        }

        [UnityTest] public IEnumerator DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arcade");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(environment.SentSignature, Is.Null);
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.True);
            Assert.That(environment.SentSignature, Is.Null);
            yield return SessionClick("Cancel entry"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.False);
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            yield return SessionClick("Confirm 1 Kredit"); yield return Idle();
            yield return BoardReady();
            var board = host.GetComponent<MoneyBoardHost>().Board;
            Assert.That(board.Session.Daily, Is.True);
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
            float until = Time.realtimeSinceStartup + 15;
            while (!environment.Consumed && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(environment.Consumed, Is.True);
            StringAssert.Contains("Result saved.", SessionText());
            var journal = environment.Services.Journal.Load(environment.Owner); yield return Wait(journal);
            Assert.That(journal.GetAwaiter().GetResult(), Is.Null);
            Click("Dialog Continue"); yield return Idle();
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(controller.BrowsingDaily, Is.True);
            yield return SessionClick("View result"); yield return Idle();
            Assert.That(controller.ResultPage().HasResult, Is.True);
            Assert.That(controller.ResultPage().Score, Is.EqualTo(expected.DailyScore));
            Assert.That(controller.ResultPage().ObjectiveTotal, Is.EqualTo(expected.ObjectiveTotal));
            // The Arcade result names the two boards the run counts on and when
            // places become final; Back to Arcade leads, with Share beside it.
            var arcade = SessionText();
            StringAssert.Contains("Daily run complete", arcade); StringAssert.Contains("Score board", arcade);
            StringAssert.Contains("Your best run counts", arcade);
            StringAssert.Contains("Places are final when each board is sealed after the day closes at 07:00 UTC.", arcade);
            Assert.That(Find("Back to Arcade").GetComponent<UnityEngine.UI.Image>().sprite.name, Does.StartWith(ZKube.Core.Generated.SkinSlots.ButtonPrimary));
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
                    var bubble = host.GetComponentsInChildren<UnityEngine.UI.Image>().Single(image => image.name == "Guardian bubble");
                    var card = host.GetComponentsInChildren<UnityEngine.UI.Image>().Single(image => image.name == "Screen card");
                    Assert.That(SkinUi.ScreenRect(bubble.rectTransform).yMin, Is.GreaterThanOrEqualTo(SkinUi.ScreenRect(card.rectTransform).yMax - .5f),
                        name + ": the bubble stays above the card");
                    foreach (var button in new[] { Find("Back to Arcade"), Find("Share") })
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
