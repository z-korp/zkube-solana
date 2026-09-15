using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private string DailyText() => string.Join("\n", host.GetComponentsInChildren<TMP_Text>().Select(value => value.text));
        private IEnumerator OpenDailyPage(string scenario = "owner-overview")
        {
            yield return PrepareEvidence(scenario);
            yield return SessionClick("Connect"); yield return Idle();
            yield return SessionClick("Daily"); yield return Idle();
            Assert.That(host.GetComponent<MoneyStartup>().Controller.BrowsingDaily, Is.True);
        }

        [UnityTest] public IEnumerator DailyNavigationReadsThePublicChallengeAndOffersOnlySavedRunResume()
        {
            yield return OpenDailyPage();
            StringAssert.Contains("Prize pot", DailyText());
            StringAssert.Contains("23:59 UTC", DailyText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume Daily"), Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit" || button.name == "Confirm 1 Kredit"), Is.False);
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(), Is.Empty);
            Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DailyResumeButtonBindsItsOwnSavedSlotWithoutNewEntry()
        {
            yield return OpenDailyPage();
            var read = evidence.Services.Runs.Inspect("daily"); yield return Wait(read);
            var token = read.GetAwaiter().GetResult().Token;
            yield return SessionClick("Resume Daily"); yield return Idle();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var board = host.GetComponent<MoneyBoardHost>().Board;
            Assert.That(controller.PlayingRun, Is.True);
            float until = Time.realtimeSinceStartup + 15;
            while (!board.Ready && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(board.Ready, Is.True, board.ReadinessIssue);
            Assert.That(board.Session.Accepted.State, Is.EqualTo(token.State));
            Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AnOccupiedDailyCannotOpenOrConfirmTheEntryChoice()
        {
            yield return OpenDailyPage(); var controller = host.GetComponent<MoneyStartup>().Controller;
            int before = evidence.Calls.Count;
            controller.AskDailyEntry(); Assert.That(controller.ConfirmingDailyEntry, Is.False);
            yield return Wait(controller.ConfirmDailyEntry());
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(evidence.Calls.Count, Is.EqualTo(before)); Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DailyPageRetainsPendingReceiptWithoutAnotherStatusCheck()
        {
            yield return PrepareEvidence("pending-confirmed-failure");
            yield return SessionClick("Connect"); yield return Idle();
            int checks = evidence.Calls.Count(call => call.Operation == "getSignatureStatuses");
            yield return SessionClick("Daily"); yield return Idle();
            StringAssert.Contains("pending transaction", DailyText());
            Assert.That(evidence.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(checks));
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Check transaction"), Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator FreezeRefreshesTheDailyPageAndKeepsSavedResultRecoveryAvailable()
        {
            yield return OpenDailyPage();
            long now = evidence.Clock(); evidence.AdvanceClock((now / 86400 + 1) * 86400 - 60 - now);
            yield return null; yield return Idle(); yield return null;
            StringAssert.Contains("Entries are closed", DailyText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume Daily"), Is.True);
            Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DisabledDailyPageRejectsALateReadAndRefetchesWhenEnabled()
        {
            yield return OpenDailyPage();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var hold = evidence.HoldNextRead("getMultipleAccounts");
            yield return SessionClick("Refresh Daily");
            try
            {
                yield return Wait(hold.Entered); controller.enabled = false;
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
                hold.Release(); yield return null;
                Assert.That(host.GetComponentsInChildren<Button>(), Is.Empty);
                controller.enabled = true; yield return Idle();
                Assert.That(controller.BrowsingDaily, Is.True); StringAssert.Contains("Prize pot", DailyText());
                Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
                Assert.That(evidence.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
        }

        [UnityTest] public IEnumerator CampaignAndDeviceNavigationRetireTheDailyPage()
        {
            yield return OpenDailyPage();
            yield return SessionClick("Campaign"); yield return Idle();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            Assert.That(controller.BrowsingDaily, Is.False); Assert.That(controller.BrowsingCampaign, Is.True);
            yield return SessionClick("Overview"); yield return Idle();
            yield return SessionClick("Daily"); yield return Idle();
            yield return SessionClick("This device"); yield return Idle();
            Assert.That(controller.BrowsingDaily, Is.False); Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume Daily"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator ProductNavigationRetiresThePreviousPagesScrollOffsetAndInertia()
        {
            yield return OpenDailyPage();
            var scroll = host.GetComponentInChildren<ScrollRect>();
            // Constrain the viewport to reproduce a scrolled tablet page
            // regardless of the test runner's Game view dimensions.
            scroll.viewport.offsetMin = new Vector2(0, scroll.viewport.rect.height - 260);
            foreach (string control in new[] { "This device", "Overview", "Campaign", "Overview", "Daily" })
            {
                Canvas.ForceUpdateCanvases();
                Assert.That(scroll.content.rect.height, Is.GreaterThan(scroll.viewport.rect.height));
                scroll.verticalNormalizedPosition = 0;
                scroll.velocity = new Vector2(0, 120);
                yield return SessionClick(control); yield return Idle(); yield return null;
                Canvas.ForceUpdateCanvases();
                Assert.That(scroll.content.anchoredPosition.y, Is.EqualTo(0).Within(.1f), control);
                Assert.That(scroll.velocity.sqrMagnitude, Is.LessThan(.01f), control);
            }
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AnUnfinishedDeviceRequestStillBlocksRunOpeningAfterPageRecreation()
        {
            yield return PrepareSessionEvidence("session-refill-success");
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var hold = sessionEvidence.HoldNextWallet();
            var operation = controller.RefillDeviceSession();
            try
            {
                yield return Wait(hold.Entered);
                controller.enabled = false; yield return null;
                controller.enabled = true; yield return Idle();
                Assert.That(controller.SessionActionPending, Is.True);
                yield return SessionClick("Overview"); yield return Idle();
                yield return SessionClick("Daily"); yield return Idle();
                var resume = host.GetComponentsInChildren<Button>().Single(button => button.name == "Resume Daily");
                Assert.That(resume.interactable, Is.False);
                int before = sessionEvidence.Calls.Count;
                yield return Wait(controller.ResumeDailyRun());
                Assert.That(controller.PlayingRun, Is.False);
                Assert.That(sessionEvidence.Calls.Count, Is.EqualTo(before));
                Assert.That(sessionEvidence.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
            yield return Wait(operation);
        }
    }
}
