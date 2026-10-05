using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private string DailyText() => string.Join("\n", host.GetComponentsInChildren<TMP_Text>().Select(value => value.text));
        private IEnumerator OpenDailyPage(string scenario = "owner-overview")
        {
            yield return PrepareScenario(scenario);
            yield return SessionClick("Connect"); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.BrowsingDaily, Is.True, "Connect opens the Arena");
        }

        [UnityTest] public IEnumerator DailyNavigationReadsThePublicChallengeAndOffersOnlySavedRunResume()
        {
            yield return OpenDailyPage();
            StringAssert.Contains("Kitsune · Japan", DailyText());
            StringAssert.Contains("0.00 SOL", DailyText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume run"), Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit" || button.name == "Confirm 1 Kredit"), Is.False);
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(), Is.Empty);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DailyResumeButtonBindsItsOwnSavedSlotWithoutNewEntry()
        {
            yield return OpenDailyPage();
            var read = environment.Services.Runs.Inspect(); yield return Wait(read);
            var token = read.GetAwaiter().GetResult().Token;
            yield return SessionClick("Resume run"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            var board = host.GetComponent<MoneyBoardHost>().Board;
            Assert.That(controller.PlayingRun, Is.True);
            float until = Time.realtimeSinceStartup + 15;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(board), Is.True, "Board is still busy or loading");
            Assert.That(board.Session.Accepted.State, Is.EqualTo(token.State));
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AnOccupiedDailyCannotOpenOrConfirmTheEntryChoice()
        {
            yield return OpenDailyPage(); var controller = host.GetComponent<MoneyIdentity>().Controller;
            int before = environment.Calls.Count;
            controller.AskDailyEntry(); Assert.That(controller.ConfirmingDailyEntry, Is.False);
            yield return Wait(controller.ConfirmDailyEntry());
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(environment.Calls.Count, Is.EqualTo(before)); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A transaction found unconfirmed is followed by the page itself. Following
        // reads its status; it never signs or sends, and past a round of the wait
        // the page says it is still checking and follows again without a tap.
        [UnityTest] public IEnumerator DailyPageFollowsAPendingTransactionItselfAndNeverSignsOrSends()
        {
            yield return PrepareScenario("pending-confirmed-failure");
            yield return SessionClick("Connect"); yield return Idle();
            yield return Until(() => Says("Still checking."), "A round of the wait ran out on a transaction that stays unconfirmed"); yield return Idle();
            Assert.That(Offers("Action progress"), Is.True, "The card's one action is the loader"); Assert.That(Offers("Try again"), Is.False, "Nobody is asked to check");
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit"), Is.False);
            Assert.That(Asked("getSignatureStatuses"), Is.GreaterThan(1));
            environment.ConfirmPendingFailure();
            yield return Until(() => Adapter.LastReceipt.Outcome == ZKube.Integration.Execution.ExecutionOutcome.ConfirmedFailure, "The next round finds the outcome"); yield return Idle();
            Assert.That(Offers("Action progress"), Is.False); Assert.That(Offers("Try again"), Is.False);
            Assert.That(Asked("signTransactions") + Asked("sendTransaction"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator FreezeRefreshesTheDailyPageAndKeepsSavedResultRecoveryAvailable()
        {
            yield return OpenDailyPage();
            long now = environment.Clock(); environment.AdvanceClock((long)ZKube.Core.NativeEngine.Daily(ZKube.Core.NativeEngine.DayAt(now)).FreezesAt - now);
            yield return null; yield return Idle(); yield return null;
            StringAssert.Contains("Entries closed", DailyText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume run"), Is.True);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }


        [UnityTest] public IEnumerator CampaignAndDeviceNavigationRetireTheDailyPage()
        {
            yield return OpenDailyPage();
            yield return SessionClick("Campaign"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.BrowsingDaily, Is.False); Assert.That(controller.BrowsingCampaign, Is.True);
            yield return SessionClick("Arena"); yield return Idle();
            yield return OpenDevice();
            Assert.That(controller.BrowsingDaily, Is.False); Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume run"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // On a short phone every page scrolls; moving to another page drops the
        // previous page's offset and its momentum.
        [UnityTest] public IEnumerator ProductNavigationRetiresThePreviousPagesScrollOffsetAndInertia()
        {
            yield return PrepareScenario("owner-overview");
            var shell = host.GetComponent<PageShell>(); ZKube.Tests.Presentation.Phones.Compact(shell);
            // The page is drawn again for this phone before anything is tapped on it.
            yield return null; yield return null;
            yield return SessionClick("Connect"); yield return Idle();
            // The map opens at the current level, so it is not among them.
            foreach (string control in new[] { "Kredits", "Arena", "Open Score board", "Arena", "Profile", "Arena" })
            {
                var scroll = shell.Scroll; Canvas.ForceUpdateCanvases();
                if (scroll.content.rect.height > scroll.viewport.rect.height)
                { scroll.verticalNormalizedPosition = 0; scroll.velocity = new Vector2(0, 120); }
                yield return SessionClick(control); yield return Idle(); yield return null;
                scroll = shell.Scroll; Canvas.ForceUpdateCanvases();
                Assert.That(scroll.content.anchoredPosition.y, Is.EqualTo(0).Within(.1f), control);
                Assert.That(scroll.velocity.sqrMagnitude, Is.LessThan(.01f), control);
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AnUnfinishedDeviceRequestStillBlocksRunOpeningAfterPageRecreation()
        {
            yield return PrepareDeviceScenario("session-refill-success");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            var hold = environment.HoldNextWallet();
            var operation = controller.RefillDeviceSession();
            try
            {
                yield return Wait(hold.Entered);
                controller.enabled = false; yield return null;
                controller.enabled = true; yield return Idle();
                Assert.That(controller.SessionActionPending, Is.True);
                yield return SessionClick("Back"); yield return Idle();
                yield return SessionClick("Arena"); yield return Idle();
                var resume = host.GetComponentsInChildren<Button>().Single(button => button.name == "Resume run");
                Assert.That(resume.interactable, Is.False);
                int before = environment.Calls.Count;
                yield return Wait(controller.ResumeDailyRun());
                Assert.That(controller.PlayingRun, Is.False);
                Assert.That(environment.Calls.Count, Is.EqualTo(before));
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
            yield return Wait(operation);
        }
    }
}
