using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;

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
            yield return SessionClick("Play"); yield return Idle();
            var board = host.GetComponent<MoneyBoardHost>().Board;
            yield return BoardReady();
            Assert.That(board.Session.Daily, Is.False);
            Click("Reroll action"); yield return BoardAccepted(1);
            Click("Pause"); yield return null;
            Click("Dialog End run"); yield return null;
            Click("Dialog End run"); yield return BoardFinished();
            StringAssert.Contains("Result saved", SessionText());
            Click("Dialog Continue"); yield return Idle();
            Assert.That(host.GetComponent<MoneyStartup>().Controller.PlayingRun, Is.False);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
        }

        [UnityTest] public IEnumerator DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Daily");
            var controller = host.GetComponent<MoneyStartup>().Controller;
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
            Click("Reroll action"); yield return BoardAccepted(1);
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
            yield return SessionClick("Copy result"); yield return null;
            StringAssert.StartsWith(Application.productName + " · Daily", GUIUtility.systemCopyBuffer);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        private IEnumerator BoardReady()
        {
            float until = Time.realtimeSinceStartup + 15;
            while (ZKube.Tests.Presentation.BoardTestState.Idle(host.GetComponent<MoneyBoardHost>()?.Board) != true && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(host.GetComponent<MoneyBoardHost>()?.Board), Is.True);
        }
        private IEnumerator BoardAccepted(uint count)
        {
            var board = host.GetComponent<MoneyBoardHost>().Board;
            float until = Time.realtimeSinceStartup + 15;
            while (board.State.ActionCounter != count && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(board.State.ActionCounter, Is.EqualTo(count));
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) && Time.realtimeSinceStartup < until) yield return null;
            yield return null;
        }
        private IEnumerator BoardFinished()
        {
            var board = host.GetComponent<MoneyBoardHost>().Board;
            float until = Time.realtimeSinceStartup + 15;
            while (board.State.Phase != (byte)CorePhase.Finished && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.Finished));
            yield return null;
        }
    }
}
