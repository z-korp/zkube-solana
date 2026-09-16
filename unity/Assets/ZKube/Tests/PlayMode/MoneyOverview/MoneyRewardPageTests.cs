using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Execution;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator PrepareClaimPage(string scenario, float textScale = 1)
        {
            yield return PrepareDeviceScenario(scenario, textScale, "Results");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return Wait(controller.OpenRewards(environment.ClaimDay)); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.True);
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay));
            StringAssert.Contains("Ladder · 200 points", SessionText());
            Assert.That(environment.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
        }
        [UnityTest] public IEnumerator ScoreRewardButtonPaysOnceAndShowsConfirmedPoints() => CollectReward("score", "sealed", 170);
        [UnityTest] public IEnumerator ThemeRewardButtonPaysOnceAndShowsConfirmedPoints() => CollectReward("theme", "sealed", 135);
        [UnityTest] public IEnumerator ScoreRewardIsCollectableAtItsExactDeadline() => CollectReward("score", "deadline", 170);
        [UnityTest] public IEnumerator ThemeRewardIsCollectableAtItsExactDeadline() => CollectReward("theme", "deadline", 135);
        private IEnumerator CollectReward(string kind, string variant, int points)
        {
            yield return PrepareClaimPage("claim-" + kind + "-" + variant, 1.3f);
            string name = kind == "score" ? "Score" : "Theme", peer = kind == "score" ? "Theme" : "Score";
            yield return SessionClick("Collect " + name); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            StringAssert.Contains(name + " reward received · " + (environment.ClaimAmount / 1_000_000_000m).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " SOL", SessionText());
            StringAssert.Contains("+" + points + " ladder points", SessionText());
            StringAssert.Contains("Ladder · " + (200 + points) + " points", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Collect " + name), Is.False);
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Collect " + peer).interactable, Is.True);
            yield return Wait(controller.CollectReward(kind));
            controller.SendMessage("OnApplicationPause", true); controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ExpiredScoreLeavesThemeAvailable() => UnavailableReward("expired", "The claim window has closed.");
        [UnityTest] public IEnumerator UnsealedScoreDoesNotOfferAClaim() => UnavailableReward("unsealed", "Results are being finalized.");
        [UnityTest] public IEnumerator ClaimedScoreDoesNotOfferASecondPayment() => UnavailableReward("claimed", "Reward collected");
        [UnityTest] public IEnumerator MissingSessionDisablesBothCollections() => UnavailableReward("missing-session", "Set up this device to collect rewards.");
        private IEnumerator UnavailableReward(string variant, string message)
        {
            yield return PrepareClaimPage("claim-score-" + variant);
            StringAssert.Contains(message, SessionText());
            var score = host.GetComponentsInChildren<Button>().SingleOrDefault(button => button.name == "Collect Score");
            Assert.That(score == null || !score.interactable, Is.True);
            var theme = host.GetComponentsInChildren<Button>().Single(button => button.name == "Collect Theme");
            Assert.That(theme.interactable, Is.EqualTo(variant != "missing-session"));
            yield return Wait(host.GetComponent<MoneyIdentity>().Controller.CollectReward("score"));
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator PendingClaimWaitsForAnExplicitCheckBeforeShowingPoints() => PendingReward(false);
        [UnityTest] public IEnumerator FailedClaimKeepsPointsAndOriginalReceipt() => PendingReward(true);
        private IEnumerator PendingReward(bool failure)
        {
            yield return PrepareClaimPage("claim-score-pending-" + (failure ? "failure" : "success"));
            yield return SessionClick("Collect Score"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller; string signature = controller.LastReceipt.Signature;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            StringAssert.Contains("Ladder · 200 points", SessionText());
            StringAssert.DoesNotContain("reward received", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Collect ")).All(button => !button.interactable), Is.True);
            int checks = environment.Calls.Count(call => call.Operation == "getSignatureStatuses");
            yield return SessionClick("Refresh results"); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(checks));
            if (failure) environment.ConfirmPendingFailure(); else environment.ConfirmPendingSuccess();
            yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(failure ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            StringAssert.Contains("Ladder · " + (failure ? 200 : 370) + " points", SessionText());
            if (failure) StringAssert.DoesNotContain("reward received", SessionText());
            else StringAssert.Contains("+170 ladder points", SessionText());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator RewardDeadlineClosesWithoutWaitingForAnotherTap()
        {
            yield return PrepareClaimPage("claim-score-deadline");
            environment.AdvanceClock(1); yield return null; yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Collect Score" && button.interactable), Is.False);
            StringAssert.Contains("The claim window has closed.", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Collect Theme").interactable, Is.True);
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator RewardReadbackFailurePreservesReceiptAndRequiresFreshValues()
        {
            yield return PrepareClaimPage("claim-score-sealed"); environment.FailFirstReadAfterJournalClear();
            yield return SessionClick("Collect Score"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            StringAssert.DoesNotContain("reward received", SessionText());
            yield return SessionClick("Refresh results"); yield return Idle();
            StringAssert.Contains("Score reward received · " + (environment.ClaimAmount / 1_000_000_000m).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " SOL", SessionText());
            StringAssert.Contains("Ladder · 370 points", SessionText());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ResultDayNavigationNeverSignsAndOtherPagesCloseResults()
        {
            yield return PrepareClaimPage("claim-score-sealed"); var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return SessionClick("Previous day"); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay - 1));
            yield return SessionClick("Next day"); yield return Idle();
            Assert.That(controller.RewardDay, Is.EqualTo(environment.ClaimDay));
            yield return SessionClick("Daily"); yield return Idle();
            Assert.That(controller.BrowsingRewards, Is.False); Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(host.GetComponentsInChildren<Transform>().Any(value => value.name == "Daily results"), Is.False);
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
