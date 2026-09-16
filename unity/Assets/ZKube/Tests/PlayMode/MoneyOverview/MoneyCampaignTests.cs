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
            var controller = host.GetComponent<MoneyStartup>().Controller;
            float until = Time.realtimeSinceStartup + 15;
            while (!PageDrawn(controller) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(PageDrawn(controller), Is.True);
            Click("Next"); Assert.That(PageDrawn(controller), Is.False, "The prior realm's ready flag cannot survive a new asynchronous request");
            Click("Next"); Assert.That(PageDrawn(controller), Is.False);
            until = Time.realtimeSinceStartup + 15;
            while (!PageDrawn(controller) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(PageDrawn(controller), Is.True);
            const System.Reflection.BindingFlags fields = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var art = controller.GetComponent<AppShell>().Artwork;
            var background = controller.GetComponent<AppShell>().Background;
            Assert.That(art.RealmId, Is.EqualTo(controller.SelectedRealm));
            Assert.That(controller.SelectedRealm, Is.EqualTo(3)); Assert.That(background.sprite, Is.SameAs(art.Sprite("background")));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [Test] public void CampaignSceneryStyleDoesNotReplaceAuthoredRealmCoordinates()
        {
            var catalog = PageCatalog.Load(); var realm = catalog.Realm(1); var scenery = catalog.Realm(2);
            host = new GameObject("Campaign scenery path", typeof(RectTransform), typeof(CampaignPathGraphic));
            var graphic = host.GetComponent<CampaignPathGraphic>();
            graphic.Configure(realm, Enumerable.Repeat("cleared", 10).ToArray(), scenery.map);
            const System.Reflection.BindingFlags fields = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            Assert.That(typeof(CampaignPathGraphic).GetField("realm", fields).GetValue(graphic), Is.SameAs(realm));
            Assert.That(typeof(CampaignPathGraphic).GetField("pathStyle", fields).GetValue(graphic), Is.SameAs(scenery.map));
            graphic.Configure(realm, Enumerable.Repeat("cleared", 10).ToArray());
            Assert.That(typeof(CampaignPathGraphic).GetField("pathStyle", fields).GetValue(graphic), Is.SameAs(realm.map), "Existing Store callers retain realm styling");
        }
        [UnityTest] public IEnumerator CampaignUsesSavedTrialAndRetainsReceiptAcrossBrowsingAndUtcRollover()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            Click("Check transaction"); yield return Idle();
            environment.Services.Campaign(environment.Owner).Runs.StartCampaign(1, 1);
            var controller = host.GetComponent<MoneyStartup>().Controller; var receipt = controller.LastReceipt;
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
            Click("Back to map"); Click("Next"); yield return null;
            Assert.That(controller.SelectedRealm, Is.EqualTo(2));
            Assert.That(host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Trial ") && !button.interactable).Count(), Is.EqualTo(10));
            Click("Overview"); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(receipt)); Assert.That(controller.BrowsingCampaign, Is.False);
            Assert.That(host.GetComponentsInChildren<BoardController>(true), Is.Empty); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator CampaignDisconnectRetiresDelayedRecordReadAndRealmArtwork()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle(); Click("Next");
            var controller = host.GetComponent<MoneyStartup>().Controller;
            delay = environment.HoldNextRead("getAccountInfo"); Click("Refresh Campaign");
            try
            {
                yield return Wait(delay.Entered);
                var disconnect = controller.Disconnect();
                Assert.That(controller.BrowsingCampaign, Is.False);
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

        [UnityTest] public IEnumerator CampaignPathUsesSharedNarrowDensityGeometryAndAuthoredPoints()
        {
            const float density = 2.75f;
            yield return PrepareScenario("owner-overview", 1.3f, density); Click("Connect"); yield return Idle();
            var canvas = host.GetComponentInChildren<Canvas>(); var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.enabled = false; scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
            scaler.scaleFactor = 280 * density / 430; scaler.enabled = true;
            var viewport = host.GetComponentInChildren<ScrollRect>().viewport;
            viewport.anchorMin = viewport.anchorMax = new Vector2(.5f, .5f); viewport.sizeDelta = new Vector2(390, 600);
            Click("Campaign"); yield return Idle(); yield return null; yield return null; Canvas.ForceUpdateCanvases();
            var catalog = PageCatalog.Load();
            for (int realm = 1; realm <= 10; realm++)
            {
                var map = host.GetComponentsInChildren<CampaignPathGraphic>().Single(); var nodes = map.GetComponentsInChildren<Button>();
                Assert.That(nodes.Length, Is.EqualTo(10));
                for (int i = 0; i < nodes.Length; i++)
                {
                    var rect = (RectTransform)nodes[i].transform; var point = catalog.Realm((byte)realm).campaignPath[i];
                    Assert.That(rect.anchorMin, Is.EqualTo(new Vector2(point.x, 1 - point.y)));
                    Assert.That(rect.rect.width * canvas.scaleFactor / density, Is.GreaterThanOrEqualTo(48 - .01));
                    Assert.That(rect.rect.height * canvas.scaleFactor / density, Is.GreaterThanOrEqualTo(48 - .01));
                    var label = nodes[i].GetComponentInChildren<TMP_Text>(); label.ForceMeshUpdate();
                    Assert.That(label.preferredWidth, Is.LessThanOrEqualTo(label.rectTransform.rect.width + 1));
                    Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 1));
                }
                if (realm != 10) { Click("Next"); yield return null; Canvas.ForceUpdateCanvases(); }
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
