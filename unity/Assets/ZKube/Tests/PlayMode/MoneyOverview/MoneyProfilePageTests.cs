using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;
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
            string standing = Text("Ladder points");
            // The lookup's answer for this address arrives.
            Set("seekerOwner", owner); Set("seeker", new ZKube.Integration.Transport.SeekerProfile { Name = "alice.skr" });
            yield return Wait(controller.OpenProfile()); yield return Idle();
            Assert.That(Text("Name text"), Is.EqualTo("alice.skr"));
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Profile badge"), Is.False, "A Seeker ID alone is not the badge");
            Set("seeker", new ZKube.Integration.Transport.SeekerProfile { Name = "alice.skr", Verified = true });
            yield return Wait(controller.OpenProfile()); yield return Idle();
            Assert.That(Text("Profile badge"), Is.EqualTo(ZKube.Integration.Presentation.MoneyAppAdapter.VerifiedSeekerBadge));
            Assert.That(Text("Ladder points"), Is.EqualTo(standing), "The badge changes no standing");
            Assert.That(environment.SentSignature, Is.Null, "Showing a name sends nothing");
        }
        // The identity panel says who and how far: the name, and the ladder
        // points as a figure led by their tier's badge. The emblem mode and the
        // tier's name are not printed on it: Automatic is a choice in the
        // picker, and the tier is the border round the emblem.
        [UnityTest] public IEnumerator TheProfilePanelShowsOnlyItsLadderPointsUnderTheName()
        {
            // The automatic emblem on the first border: the panel that printed its mode and its tier's name.
            yield return PrepareProfilePage("profile-auto");
            var page = host.GetComponent<MoneyIdentity>().Controller.ProfilePage();
            Assert.That(Text("Ladder points"), Is.EqualTo(NumberFit.Figure(page.LadderPoints.Value)));
            var badge = host.GetComponentsInChildren<Image>().Single(image => image.name == "Ladder badge");
            Assert.That(badge.sprite.name, Does.StartWith(SkinSlots.LadderBadge(page.LadderTier)), "The figure's pictogram is its tier's badge");
            var card = SkinUi.ScreenRect(host.GetComponentsInChildren<Image>().Single(image => image.name == "Wearer card").rectTransform);
            var words = host.GetComponentsInChildren<TMP_Text>().Where(text => text.isActiveAndEnabled && card.Contains(SkinUi.ScreenRect(text.rectTransform).center))
                .Select(text => text.text).ToArray();
            foreach (string printed in words)
            {
                StringAssert.DoesNotContain("automatic", printed.ToLowerInvariant());
                StringAssert.DoesNotContain("ladder", printed.ToLowerInvariant());
                foreach (var tier in ProfileIdentityCatalog.Tiers) StringAssert.DoesNotContain(tier.Name, printed);
            }
            Assert.That(words.Length, Is.EqualTo(3), "The name, the figure and the Records button; printed " + string.Join(" | ", words));
        }
        // The profile that asks for the device fits both phones without scrolling: Manage device stands
        // whole over the tab bar. The compact phone has no height to spare, so its emblem card tightens
        // evenly, its padding and the gaps between its rows; the notice and every word keep their size.
        [UnityTest] public IEnumerator TheProfileThatAsksForTheDeviceFitsBothPhonesWithoutScrolling()
        {
            var padding = new System.Collections.Generic.Dictionary<string, float>();
            foreach (var (use, phone) in new (System.Action<PageShell>, string)[] {
                (shell => ZKube.Tests.Presentation.Phones.Seeker(shell), "Seeker"), (shell => ZKube.Tests.Presentation.Phones.Compact(shell), "360 x 640") })
            {
                yield return PrepareScenario("owner-overview"); var shell = host.GetComponent<PageShell>(); use(shell);
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenProfile()); yield return Idle();
                for (float until = Time.realtimeSinceStartup + 5; shell.Moving && Time.realtimeSinceStartup < until;) yield return null;
                yield return null; Canvas.ForceUpdateCanvases();
                yield return ZKube.Tests.Presentation.Captures.Snap(shell, "arena profile manage device " + phone);
                Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Viewport.rect.height + .5f), phone + ": the page does not scroll");
                var manage = SkinUi.ScreenRect((RectTransform)Find("Manage device").transform);
                var tabs = SkinUi.ScreenRect((RectTransform)host.GetComponentInChildren<SkinTabBar>().transform);
                Assert.That(manage.yMin, Is.GreaterThanOrEqualTo(tabs.yMax - .5f), phone + ": Manage device stands whole over the tab bar, " + manage + " over " + tabs);
                var texts = host.GetComponentsInChildren<TMP_Text>().Where(text => text.isActiveAndEnabled).ToArray();
                var notice = texts.Single(text => text.text == "Set up this device to change your emblem or border.");
                Assert.That(notice.fontSize, Is.GreaterThanOrEqualTo(12 - .01f), phone + ": the notice keeps its size");
                foreach (var name in texts.Where(text => text.name.StartsWith("Emblem ") && text.name.EndsWith(" name")))
                    Assert.That(name.fontSize, Is.GreaterThanOrEqualTo(11 - .01f), phone + ": " + name.name + " keeps the 11 dp floor");
                var card = SkinUi.ScreenRect(host.GetComponentsInChildren<Image>().Single(image => image.name == "Emblem card").rectTransform);
                var faces = host.GetComponentsInChildren<Image>().Where(image => image.name == "Guardian portrait").Select(image => SkinUi.ScreenRect(image.rectTransform)).ToArray();
                Assert.That(faces.Length, Is.GreaterThan(4), phone + ": the emblems are drawn");
                // The card's padding under its last row, as a share of its width.
                padding[phone] = (faces.Min(face => face.yMin) - card.yMin) / card.width;
                yield return EndScenario();
            }
            Assert.That(padding["360 x 640"], Is.LessThan(padding["Seeker"]), "Only the phone with no height to spare tightens its card");
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
            // The emblem card marks the stored emblem as worn; Automatic stores none.
            byte stored = latestEmblem ?? emblem;
            CollectionAssert.AreEqual(stored == 0 ? new byte[0] : new[] { stored },
                controller.ProfilePage().Emblems.Where(choice => choice.Detail == "Worn").Select(choice => choice.Id).ToArray());
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
