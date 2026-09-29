using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator CampaignRealmNavigationIsNotReadyUntilTheFinalRequestedArtworkCompletes()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            float until = Time.realtimeSinceStartup + 15;
            while (!PageDrawn(controller) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(PageDrawn(controller), Is.True);
            Click("Next"); Assert.That(PageDrawn(controller), Is.False, "The prior realm's ready flag cannot survive a new asynchronous request");
            Click("Next"); Assert.That(PageDrawn(controller), Is.False);
            until = Time.realtimeSinceStartup + 15;
            while (!PageDrawn(controller) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(PageDrawn(controller), Is.True);
            var art = controller.GetComponent<PageShell>().Artwork;
            var background = controller.GetComponent<PageShell>().Background;
            Assert.That(art.RealmId, Is.EqualTo(controller.SelectedRealm));
            Assert.That(controller.SelectedRealm, Is.EqualTo(3)); Assert.That(background.sprite, Is.SameAs(art.SkinRealm(ZKube.Core.Generated.SkinSlots.Background)));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator CampaignUsesSavedTrialAndRetainsReceiptAcrossBrowsingAndUtcRollover()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return Wait(controller.CheckTransaction()); yield return Idle();
            environment.Services.Campaign(environment.Owner).Runs.StartCampaign(1, 1);
            var receipt = controller.LastReceipt;
            Click("Campaign"); yield return Idle(); yield return null;
            Assert.That(controller.BrowsingCampaign, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Single(button => button.name == "Trial 1").interactable, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Trial ") && !button.interactable).All(button => !button.interactable), Is.True);
            Click("Trial 1"); yield return null;
            Assert.That(controller.SelectedTrial, Is.EqualTo(1));
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Rules of your saved run"), Is.True);
            int before = environment.Calls.Count;
            environment.AdvanceClock(86400); yield return null; yield return null;
            Assert.That(controller.BrowsingCampaign, Is.True); Assert.That(controller.SelectedTrial, Is.EqualTo(1));
            Assert.That(environment.Calls.Count, Is.EqualTo(before), "UTC update cannot switch pages or silently refresh owner data");
            Click("Back to map"); yield return Idle(); Click("Next"); yield return Idle();
            Assert.That(controller.SelectedRealm, Is.EqualTo(2));
            // A closed realm shows why it waits, with no trial to open.
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Trial ") && button.interactable), Is.False);
            StringAssert.Contains("final trial", string.Join("\n", host.GetComponentsInChildren<TMP_Text>().Select(text => text.text)));
            Click("Arcade"); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(receipt)); Assert.That(controller.BrowsingCampaign, Is.False);
            Assert.That(host.GetComponentsInChildren<BoardController>(true), Is.Empty); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator CampaignDisconnectRetiresDelayedRecordReadAndRealmArtwork()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle(); Click("Next"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            delay = environment.HoldNextRead("getAccountInfo"); _ = controller.RefreshOverview();
            try
            {
                yield return Wait(delay.Entered);
                var disconnect = controller.Disconnect();
                Assert.That(controller.BrowsingCampaign, Is.False); yield return null;
                Assert.That(host.GetComponentsInChildren<CampaignPathGraphic>(), Is.Empty);
                delay.Release(); yield return Wait(disconnect); yield return null;
                Assert.That(environment.Services.Identity.Owner, Is.Null);
                Assert.That(controller.LastReceipt, Is.Null);
                Assert.That(host.GetComponentsInChildren<CampaignPathGraphic>(), Is.Empty);
                Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text.StartsWith("Saved Campaign run")), Is.False);
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { delay.Release(); }
        }

        // On a 280 dp, 440 dpi phone at larger text the open realm's ten nodes
        // are each at least 48 dp with their numbers inside them.
        [UnityTest] public IEnumerator CampaignPathUsesSharedNarrowDensityGeometryAndAuthoredPoints()
        {
            const float density = 2.75f;
            yield return PrepareScenario("owner-overview", 1.3f, density);
            ZKube.Tests.Presentation.Phones.CompactOfWidth(host.GetComponent<PageShell>(), 280, density);
            Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle(); yield return null; Canvas.ForceUpdateCanvases();
            var nodes = host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Trial ")).ToArray();
            Assert.That(nodes.Length, Is.EqualTo(10));
            foreach (var node in nodes)
            {
                var rect = SkinUi.ScreenRect((RectTransform)node.transform);
                Assert.That(rect.width / density, Is.GreaterThanOrEqualTo(48 - .01), node.name);
                Assert.That(rect.height / density, Is.GreaterThanOrEqualTo(48 - .01), node.name);
                var label = node.GetComponentInChildren<TMP_Text>(); label.ForceMeshUpdate();
                Assert.That(label.preferredWidth, Is.LessThanOrEqualTo(label.rectTransform.rect.width + 1), node.name);
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
