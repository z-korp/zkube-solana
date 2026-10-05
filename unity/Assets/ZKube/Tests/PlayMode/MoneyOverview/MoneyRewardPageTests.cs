using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // The boards page on the claim day, showing one board.
        private IEnumerator PrepareClaimPage(string scenario, float textScale = 1, string kind = "score")
        {
            yield return PrepareDeviceScenario(scenario, textScale, "Arena");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return Wait(controller.OpenRewards(environment.ClaimDay, kind)); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.True);
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay));
            Assert.That(controller.BoardKind, Is.EqualTo(kind));
            Assert.That(host.GetComponent<PageViews>().ShownPanel, Is.EqualTo("Boards"));
            Assert.That(environment.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
        }
        [UnityTest] public IEnumerator ScoreRewardButtonPaysOnceAndShowsConfirmedPoints() => CollectReward("score", "sealed", 170);
        [UnityTest] public IEnumerator ThemeRewardButtonPaysOnceAndShowsConfirmedPoints() => CollectReward("theme", "sealed", 135);
        [UnityTest] public IEnumerator ScoreRewardIsCollectableAtItsExactDeadline() => CollectReward("score", "deadline", 170);
        private IEnumerator CollectReward(string kind, string variant, int points)
        {
            yield return PrepareClaimPage("claim-" + kind + "-" + variant, 1.3f, kind);
            // The boards' names in general contexts: Score and Objective.
            string name = kind == "score" ? "Score" : "Objective", peer = kind == "score" ? "Objective" : "Score";
            yield return SessionClick("Collect " + name); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            StringAssert.Contains(name + " reward received · " + MoneyText.Sol(environment.ClaimAmount), SessionText());
            StringAssert.Contains("+" + points + " ladder points", SessionText());
            StringAssert.Contains("claimed", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Collect " + name), Is.False);
            // The other board's reward is the next one: its button leads there.
            yield return SessionClick("Next reward"); yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Collect " + peer).interactable, Is.True);
            yield return Wait(controller.CollectReward(kind));
            controller.SendMessage("OnApplicationPause", true); controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator AnExpiredDailyClosesBothBoards() => UnavailableReward("expired", "Claim window closed");
        [UnityTest] public IEnumerator UnsealedScoreDoesNotOfferAClaim() => UnavailableReward("unsealed", "Results pending");
        [UnityTest] public IEnumerator ClaimedScoreDoesNotOfferASecondPayment() => UnavailableReward("claimed", "claimed");
        [UnityTest] public IEnumerator MissingSessionDisablesBothCollections() => UnavailableReward("missing-session", "Set up device");
        private IEnumerator UnavailableReward(string variant, string message)
        {
            yield return PrepareClaimPage("claim-score-" + variant);
            StringAssert.Contains(message, SessionText());
            var score = host.GetComponentsInChildren<Button>().SingleOrDefault(button => button.name == "Collect Score");
            Assert.That(score == null || !score.interactable, Is.True);
            // Without a device session the claim is replaced by the way to set the device up.
            yield return SessionClick("Objective board"); yield return Idle();
            var theme = host.GetComponentsInChildren<Button>().SingleOrDefault(button => button.name == "Collect Objective");
            // The boards seal and expire together with their Daily; only a
            // reward already collected leaves the other board's on offer.
            if (variant == "claimed") Assert.That(theme.interactable, Is.True);
            else Assert.That(theme == null || !theme.interactable, Is.True);
            yield return Wait(host.GetComponent<MoneyIdentity>().Controller.CollectReward("score"));
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator RewardDeadlineClosesWithoutWaitingForAnotherTap()
        {
            yield return PrepareClaimPage("claim-score-deadline");
            environment.AdvanceClock(1); yield return null; yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Collect Score" && button.interactable), Is.False);
            StringAssert.Contains("Claim window closed", SessionText());
            yield return SessionClick("Objective board"); yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Collect Objective" && button.interactable), Is.False);
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ResultDayNavigationNeverSignsAndOtherPagesCloseResults()
        {
            yield return PrepareClaimPage("claim-score-sealed"); var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return SessionClick("Previous day"); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay - 1));
            yield return SessionClick("Next day"); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay));
            yield return SessionClick("Objective board"); yield return Idle();
            Assert.That(controller.BoardKind, Is.EqualTo("theme"));
            yield return SessionClick("Arena"); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.False); Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(host.GetComponent<PageViews>().ShownPanel, Is.Null);
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
