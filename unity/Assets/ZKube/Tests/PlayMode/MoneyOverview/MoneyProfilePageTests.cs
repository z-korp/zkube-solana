using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Execution;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator PrepareProfilePage(string scenario, float scale = 1)
        {
            yield return PrepareDeviceScenario(scenario, scale, "Profile");
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.BrowsingProfile, Is.True);
            Assert.That(environment.SentSignature, Is.Null);
        }
        [UnityTest] public IEnumerator FeaturedIdentityRequiresAnExplicitWearAndShowsConfirmedReadback() => WearProfile("profile-success", 8, 3);
        [UnityTest] public IEnumerator AutomaticCanBeRestoredWithItsSelectedBorder() => WearProfile("profile-auto", 0, 0);
        [UnityTest] public IEnumerator ChangingOnlyTheBorderKeepsAutomaticStored() => WearProfile("profile-border-only", 0, 3);
        [UnityTest] public IEnumerator TheAutomaticPortraitCanBeChosenAsAnExplicitEmblem() => WearProfile("profile-explicit-auto-target", 12, 0);
        [UnityTest] public IEnumerator ANewerConfirmedProfileChoiceIsDisplayed() => WearProfile("profile-superseded", 8, 3, 10, 4);

        private IEnumerator WearProfile(string scenario, byte emblem, byte border, byte? latestEmblem = null, byte? latestBorder = null)
        {
            yield return PrepareProfilePage(scenario, 1.3f);
            yield return SessionClick("Emblem " + emblem);
            yield return SessionClick("Border " + border);
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.SelectedEmblem, Is.EqualTo(emblem));
            Assert.That(controller.SelectedBorder, Is.EqualTo(border));
            Assert.That(environment.SentSignature, Is.Null);
            yield return SessionClick("Wear selection"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            Assert.That(controller.SelectedEmblem, Is.EqualTo(latestEmblem ?? emblem));
            Assert.That(controller.SelectedBorder, Is.EqualTo(latestBorder ?? border));
            StringAssert.Contains("Wearing · " + ProfileIdentityCatalog.Emblems.Single(value => value.Id == (latestEmblem ?? emblem)).Name, SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Wear selection").interactable, Is.False);
            yield return Wait(controller.WearProfileSelection());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
            foreach (var button in host.GetComponentsInChildren<Button>())
            {
                var label = button.GetComponentInChildren<TMP_Text>();
                Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 2), button.name);
            }
        }
        [UnityTest] public IEnumerator FreshProfileDoesNotOfferOpenedButUnearnedGuardians()
        {
            yield return PrepareProfilePage("profile-fresh");
            StringAssert.Contains("Campaign · 0 / 300 stars", SessionText());
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            foreach (var button in host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Emblem ") && button.name != "Emblem 0"))
                Assert.That(button.interactable, Is.False, button.name);
            controller.SelectProfileEmblem(1); yield return Wait(controller.WearProfileSelection());
            Assert.That(controller.SelectedEmblem, Is.Zero);
            Assert.That(environment.SentSignature, Is.Null);
        }
        [UnityTest] public IEnumerator MissingDeviceSessionKeepsProfileVisibleWithoutWrites()
        {
            yield return PrepareProfilePage("profile-missing-session");
            StringAssert.Contains("Set up this device to change your emblem or border.", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Wear selection").interactable, Is.False);
            Assert.That(environment.SentSignature, Is.Null);
        }
        [UnityTest] public IEnumerator PendingProfileWaitsForExplicitConfirmation() => PendingProfile(false);
        [UnityTest] public IEnumerator FailedProfileWriteKeepsThePriorIdentity() => PendingProfile(true);
        private IEnumerator PendingProfile(bool failure)
        {
            yield return PrepareProfilePage("profile-pending-" + (failure ? "failure" : "success"));
            yield return SessionClick("Emblem 8"); yield return SessionClick("Border 3");
            yield return SessionClick("Wear selection"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            string receipt = controller.LastReceipt.Signature;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(controller.SelectedEmblem, Is.Zero);
            yield return SessionClick("Refresh profile"); yield return Idle();
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(receipt));
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            if (failure) environment.ConfirmPendingFailure(); else environment.ConfirmPendingSuccess();
            yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(receipt));
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(failure ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.SelectedEmblem, Is.EqualTo(failure ? 0 : 8));
            Assert.That(controller.SelectedBorder, Is.EqualTo(failure ? 0 : 3));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ConfirmedProfileReceiptSurvivesReadFailureAndResume()
        {
            yield return PrepareProfilePage("profile-success");
            yield return SessionClick("Emblem 8"); yield return SessionClick("Border 3");
            environment.FailFirstReadAfterJournalClear();
            yield return SessionClick("Wear selection"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            string receipt = controller.LastReceipt.Signature;
            controller.SendMessage("OnApplicationPause", true); controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(receipt));
            Assert.That(controller.SelectedEmblem, Is.EqualTo(8));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
        }
    }
}
