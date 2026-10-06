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
            Assert.That(Find(LitTab).interactable, Is.True, "The way back during a read"); Assert.That(Find("Previous day").interactable, Is.True, "The stepper during a read");
            yield return SessionClick("Previous day"); delay.Release(); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay - 1));
            Assert.That(PageReadCurrent("rewardRead"), Is.True, "The day stepped to is read");

            delay = environment.HoldNextRead("getMultipleAccounts"); _ = controller.RefreshOverview();
            yield return Wait(delay.Entered); yield return null; yield return null;
            yield return Return(); delay.Release(); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.False); Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(PageReadCurrent("dailyRead"), Is.True);

            // Today is the last day there is: no arrow leads past it.
            yield return Wait(controller.OpenRewards()); yield return Idle();
            Assert.That(host.GetComponentsInChildren<UnityEngine.UI.Button>().Any(button => button.name == "Next day" && button.interactable), Is.False);
            Assert.That(Find(LitTab).interactable, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The Boards page from top to bottom: the title alone in its row, the
        // pair, the player's row, the rows, the one button, and the day stepper
        // as the page's foot over the tab bar. The stepper is one band of its
        // own, its arrows chevrons and not tablets.
        [UnityTest] public IEnumerator TheDayStepperIsTheBoardsPagesFootUnderTheRowsAndItsOneButton()
        {
            foreach (var phone in new Action<PageShell>[] { value => ZKube.Tests.Presentation.Phones.Seeker(value), value => ZKube.Tests.Presentation.Phones.Compact(value) })
            {
                yield return PrepareClaimPage("claim-score-sealed");
                var shell = host.GetComponent<PageShell>(); phone(shell);
                yield return Wait(Adapter.RefreshOverview()); yield return Idle(); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                Rect Of(string name) => SkinUi.ScreenRect((RectTransform)host.GetComponentsInChildren<Transform>().Single(piece => piece.name == name && piece.gameObject.activeInHierarchy));
                Rect stepper = Of("Day stepper"), rows = Of("Board rows"), title = Of("Screen title plate"), claim = Of("Collect Score"), you = Of("Your row card");
                var tabs = SkinUi.ScreenRect((RectTransform)host.GetComponentsInChildren<SkinTabBar>().Single().transform);
                Assert.That(stepper.yMin, Is.GreaterThanOrEqualTo(tabs.yMax - .5f), "The stepper stands over the tab bar");
                Assert.That(claim.yMin, Is.GreaterThanOrEqualTo(stepper.yMax - .5f), "The claim sits just above the stepper");
                Assert.That(rows.yMin, Is.GreaterThanOrEqualTo(claim.yMax - .5f), "The rows fill the space above it");
                Assert.That(you.yMin, Is.GreaterThanOrEqualTo(rows.yMax - .5f)); Assert.That(title.yMin, Is.GreaterThanOrEqualTo(you.yMax - .5f), "The title is at the top");
                foreach (string arrow in new[] { "Previous day", "Next day" })
                {
                    var face = Find(arrow); var rect = SkinUi.ScreenRect((RectTransform)face.transform);
                    Assert.That(rect.yMin >= stepper.yMin - .5f && rect.yMax <= stepper.yMax + .5f && rect.xMin >= stepper.xMin - .5f && rect.xMax <= stepper.xMax + .5f, Is.True, arrow + " is inside the band");
                    Assert.That(face.GetComponent<UnityEngine.UI.Image>().sprite, Is.Null, arrow + " is a chevron in the band, not a tablet");
                    Assert.That(Mathf.Min(rect.width, rect.height), Is.GreaterThanOrEqualTo(48 - .01f), arrow + " is 48 dp to touch");
                }
                // Only the rows scroll: the page itself does not.
                Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Viewport.rect.height + .5f), "The page does not scroll");
                yield return SessionClick("Previous day"); yield return Idle();
                Assert.That(host.GetComponent<MoneyIdentity>().Controller.RewardDay, Is.EqualTo(environment.ClaimDay - 1));
                yield return EndScenario();
            }
        }
    }
}
