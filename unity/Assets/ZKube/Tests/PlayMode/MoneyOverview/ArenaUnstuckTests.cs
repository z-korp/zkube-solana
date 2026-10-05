using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // A sent transaction whose outcome cannot be read, look after look: the
        // follow stops after a few, the page says why with a retry, and nothing
        // else waits on it. Every tab opens, the Campaign plays and Home from its
        // pause comes back to a working page. Once the answer can be read, the
        // retry finds the outcome.
        [UnityTest] public IEnumerator ATransactionThatCannotBeConfirmedStopsBeingFollowedSaysWhyAndFreezesNothing()
        {
            yield return PrepareScenario("pending-confirmed-failure");
            environment.Http.FailEvery = "getSignatureStatuses"; environment.Http.EveryFailure = new FormatException("RPC response exceeds its bound");
            Click("Connect");
            yield return Until(() => Says("This is not confirmed yet.") && Offers("Try again"), "The follow stopped with its reason and a retry");
            yield return Idle();
            Assert.That(Says("could not read"), Is.True, SessionText());
            int looks = Asked("getSignatureStatuses");
            yield return new WaitForSecondsRealtime(1f);
            Assert.That(Asked("getSignatureStatuses"), Is.EqualTo(looks), "Nothing loops on a reply it cannot read");
            var controller = host.GetComponent<MoneyIdentity>().Controller; var views = host.GetComponent<PageViews>();
            Assert.That(controller.Busy, Is.False);

            yield return SessionClick("Campaign"); yield return Idle();
            Assert.That(views.Shown, Is.EqualTo(AppPage.Campaign));
            Click("Trial 1"); yield return Idle(); Click("Play"); yield return BoardReady();
            Click("Pause"); yield return null; Click(PauseDialog.Home); yield return Idle();
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(views.Shown, Is.EqualTo(AppPage.Home), "Home from the pause opens the Arena's page");
            Assert.That(controller.BrowsingDaily, Is.True); Assert.That(Offers("Try again"), Is.True);
            yield return SessionClick("Profile"); yield return Idle();
            Assert.That(controller.BrowsingDaily, Is.False); Assert.That(views.Shown, Is.EqualTo(AppPage.Profile));
            yield return SessionClick("Settings"); yield return Idle();
            Assert.That(views.Shown, Is.EqualTo(AppPage.Settings));
            yield return SessionClick("Arena"); yield return Idle();
            Assert.That(controller.BrowsingDaily, Is.True);
            // A page that opens looks once as it reads; none of them starts the loop again.
            Assert.That(Offers("Try again"), Is.True); Assert.That(Says("This is not confirmed yet."), Is.True);
            looks = Asked("getSignatureStatuses");
            yield return new WaitForSecondsRealtime(1f);
            Assert.That(Asked("getSignatureStatuses"), Is.EqualTo(looks), "Opening pages starts no loop while the reason stands");

            environment.Http.FailEvery = null; environment.ConfirmPendingFailure();
            yield return SessionClick("Try again");
            yield return Until(() => controller.LastReceipt?.Outcome == ZKube.Integration.Execution.ExecutionOutcome.ConfirmedFailure, "The retry reads the outcome"); yield return Idle();
            Assert.That(Says("This is not confirmed yet."), Is.False);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False, "Following only reads");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        private object PageRead(string field) => typeof(MoneyAppAdapter).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic)
            .GetValue(host.GetComponent<MoneyIdentity>().Controller);
        private bool PageReadCurrent(string field) => PageRead(field) is object read && (bool)read.GetType().GetProperty("IsCurrent").GetValue(read);
        // What a consumed run, a purchase or any other confirmed transaction does to
        // a page that is open: its read goes stale. The page reads again without a tap.
        private IEnumerator GoesStaleAndReadsAgain(string field, string page)
        {
            Assert.That(PageReadCurrent(field), Is.True, page + " is read");
            int asked = Asked("getMultipleAccounts") + Asked("getAccountInfo");
            environment.Services.Identity.InvalidateData(environment.Owner);
            Assert.That(PageReadCurrent(field), Is.False, page + "'s read is stale");
            yield return Until(() => PageReadCurrent(field), page + " read again by itself"); yield return Idle();
            Assert.That(Asked("getMultipleAccounts") + Asked("getAccountInfo"), Is.GreaterThan(asked), page);
            Assert.That(Says("Refresh"), Is.False, page + " asks for no refresh: " + SessionText());
        }
        [UnityTest] public IEnumerator EveryArenaPageReadsAgainByItselfWhenItsReadGoesStale()
        {
            yield return PrepareClaimPage("claim-score-sealed");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return GoesStaleAndReadsAgain("rewardRead", "Boards");
            Assert.That(host.GetComponent<PageViews>().ShownPanel, Is.EqualTo("Boards"));
            Assert.That(host.GetComponentsInChildren<Transform>().Any(piece => piece.name.StartsWith("Board rows")), Is.True, "The rows are back");
            yield return Wait(controller.OpenKredits()); yield return Idle();
            yield return GoesStaleAndReadsAgain("kreditRead", "Kredits");
            yield return Wait(controller.OpenProfile()); yield return Idle();
            yield return GoesStaleAndReadsAgain("profileRead", "Profile");
            yield return OpenDevice();
            yield return GoesStaleAndReadsAgain("sessionRead", "Device");
            yield return Wait(controller.OpenDaily()); yield return Idle();
            yield return GoesStaleAndReadsAgain("dailyRead", "Arena");
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Back and the stepper are ways off the page: a read in progress holds
        // neither. The stepper stops only at its real limits.
        [UnityTest] public IEnumerator BackAndTheStepperNeverWaitForAReadAndStopOnlyAtTheirLimits()
        {
            yield return PrepareClaimPage("claim-score-sealed");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            delay = environment.HoldNextRead("getMultipleAccounts"); _ = controller.RefreshOverview();
            yield return Wait(delay.Entered); yield return null; yield return null;
            Assert.That(controller.Busy, Is.True);
            Assert.That(Find("Back").interactable, Is.True, "Back during a read"); Assert.That(Find("Previous day").interactable, Is.True, "The stepper during a read");
            yield return SessionClick("Previous day"); delay.Release(); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay - 1));
            Assert.That(PageReadCurrent("rewardRead"), Is.True, "The day stepped to is read");

            delay = environment.HoldNextRead("getMultipleAccounts"); _ = controller.RefreshOverview();
            yield return Wait(delay.Entered); yield return null; yield return null;
            yield return SessionClick("Back"); delay.Release(); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.False); Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(PageReadCurrent("dailyRead"), Is.True);

            // Today is the last day there is: no arrow leads past it.
            yield return Wait(controller.OpenRewards()); yield return Idle();
            Assert.That(host.GetComponentsInChildren<UnityEngine.UI.Button>().Any(button => button.name == "Next day" && button.interactable), Is.False);
            Assert.That(Find("Back").interactable, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
