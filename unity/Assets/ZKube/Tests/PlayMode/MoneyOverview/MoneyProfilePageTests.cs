using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Presentation;

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
        // The profile names its player by the shortened address until the
        // address's Seeker ID resolves, then by the ID, and wears the
        // verified-Seeker badge when the wallet holds a Seeker Genesis Token.
        // The lookups run beside the page: the profile is drawn and usable
        // before they answer, and the badge changes nothing else.
        [UnityTest] public IEnumerator TheProfileShowsTheSeekerIdAndBadgeWithoutWaitingForThem()
        {
            yield return PrepareProfilePage("profile-success");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            string owner = environment.Owner;
            Assert.That(Text("Name text"), Is.EqualTo(owner.Substring(0, 4) + "…" + owner.Substring(owner.Length - 4)), "Without a Seeker ID, the shortened address");
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Your records" && button.interactable), Is.True);
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Profile badge"), Is.False, "No badge until a Genesis Token is found");
            string standing = Text("Standing line");
            // The lookup's answer for this address arrives.
            Set("seekerOwner", owner); Set("seeker", new ZKube.Integration.Transport.SeekerProfile { Name = "alice.skr" });
            yield return Wait(controller.OpenProfile()); yield return Idle();
            Assert.That(Text("Name text"), Is.EqualTo("alice.skr"));
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Profile badge"), Is.False, "A Seeker ID alone is not the badge");
            Set("seeker", new ZKube.Integration.Transport.SeekerProfile { Name = "alice.skr", Verified = true });
            yield return Wait(controller.OpenProfile()); yield return Idle();
            Assert.That(Text("Profile badge"), Is.EqualTo(ZKube.Integration.Presentation.MoneyAppAdapter.VerifiedSeekerBadge));
            Assert.That(Text("Standing line"), Is.EqualTo(standing), "The badge changes no standing");
            Assert.That(environment.SentSignature, Is.Null, "Showing a name sends nothing");
        }
        [UnityTest] public IEnumerator FeaturedIdentityRequiresAnExplicitWearAndShowsConfirmedReadback() => WearProfile("profile-success", 8, 3);
        [UnityTest] public IEnumerator AutomaticCanBeRestoredWithItsSelectedBorder() => WearProfile("profile-auto", 0, 0);
        [UnityTest] public IEnumerator ChangingOnlyTheBorderKeepsAutomaticStored() => WearProfile("profile-border-only", 0, 3);
        [UnityTest] public IEnumerator TheAutomaticPortraitCanBeChosenAsAnExplicitEmblem() => WearProfile("profile-explicit-auto-target", 12, 0);
        [UnityTest] public IEnumerator ANewerConfirmedProfileChoiceIsDisplayed() => WearProfile("profile-superseded", 8, 3, 10, 4);

        // Choosing an emblem, then a border, previews the change; only Wear
        // selection writes it, once, and the profile then shows the confirmed look.
        private IEnumerator WearProfile(string scenario, byte emblem, byte border, byte? latestEmblem = null, byte? latestBorder = null)
        {
            yield return PrepareProfilePage(scenario, 1.3f);
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            if (controller.SelectedEmblem != emblem) { yield return SessionClick("Emblem " + emblem); yield return Idle(); }
            if (controller.SelectedBorder != border)
            {
                // The preview keeps the choice when it goes back for a border.
                if (host.GetComponent<PageViews>().ShownPanel == "Profile Selection") { yield return SessionClick("Back"); yield return Idle(); }
                yield return SessionClick("Choose a border"); yield return Idle();
                yield return SessionClick("Border " + border); yield return Idle();
            }
            Assert.That(controller.SelectedEmblem, Is.EqualTo(emblem));
            Assert.That(controller.SelectedBorder, Is.EqualTo(border));
            Assert.That(environment.SentSignature, Is.Null);
            foreach (var button in host.GetComponentsInChildren<Button>())
            {
                var label = button.GetComponentInChildren<TMP_Text>(); if (label == null) continue;
                Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 2), button.name);
            }
            yield return SessionClick("Wear selection"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            Assert.That(controller.SelectedEmblem, Is.EqualTo(latestEmblem ?? emblem));
            Assert.That(controller.SelectedBorder, Is.EqualTo(latestBorder ?? border));
            var worn = ProfileEmblems.All.Single(value => value.Id == (latestEmblem ?? emblem));
            StringAssert.Contains(worn.Id == 0 ? "(automatic)" : worn.Name, Text("Standing line"));
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Wear selection" && button.interactable), Is.False);
            yield return Wait(controller.WearProfileSelection());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator FreshProfileDoesNotOfferOpenedButUnearnedGuardians()
        {
            yield return PrepareProfilePage("profile-fresh");
            Assert.That(Text("Campaign stars"), Is.EqualTo("0/300"));
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
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Wear selection" && button.interactable), Is.False);
            Assert.That(environment.SentSignature, Is.Null);
        }
    }
}
