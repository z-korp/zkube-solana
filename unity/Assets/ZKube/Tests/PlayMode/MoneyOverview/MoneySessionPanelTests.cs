using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator APendingTransactionIsFollowedOnTheDevicePageAndAcrossForegroundWithoutSigningOrSending()
        {
            yield return PrepareScenario("pending-confirmed-failure"); Click("Connect"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            yield return Until(() => Says("Still checking."), "The Arena followed the transaction it found"); yield return Idle();
            string signature = controller.LastReceipt.Signature;
            yield return OpenDevice();
            yield return Until(() => Offers("Action progress"), "The device page shows it still confirming"); yield return Idle();
            Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(controller.BrowsingCampaign, Is.False);
            Assert.That(Says("Still checking."), Is.True); Assert.That(Offers("Try again"), Is.False, "Nobody is asked to check");
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enable device"), Is.False);
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.Pending));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            controller.SendMessage("OnApplicationPause", true);
            controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            environment.ConfirmPendingFailure();
            yield return Until(() => controller.LastReceipt.Outcome == ZKube.Integration.Execution.ExecutionOutcome.ConfirmedFailure, "The next round finds the outcome"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedFailure));
            StringAssert.Contains("The transaction failed. Nothing changed.", SessionText());
            Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(Asked("signTransactions") + Asked("sendTransaction"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DeviceAndCampaignNavigationKeepOneVisiblePanel()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            yield return OpenDevice();
            var controller = host.GetComponent<MoneyIdentity>().Controller; var views = host.GetComponent<PageViews>();
            Assert.That(views.ShownPanel, Is.EqualTo("Device"));
            yield return Return(); yield return Idle();
            // Settings is a tab page: the tab bar leaves it.
            yield return SessionClick("Campaign"); yield return Idle();
            Assert.That(controller.BrowsingSession, Is.False);
            Assert.That(views.ShownPanel, Is.Null); Assert.That(views.Shown, Is.EqualTo(AppPage.Campaign));
            yield return SessionClick("Arena"); yield return Idle();
            yield return OpenDevice();
            Assert.That(controller.BrowsingSession, Is.True); Assert.That(controller.BrowsingCampaign, Is.False);
            Assert.That(views.ShownPanel, Is.EqualTo("Device")); Assert.That(views.Shown, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        private string SessionText() => string.Join("\n", host.GetComponentsInChildren<TMP_Text>().Select(value => value.text));
        // This device is managed from Settings.
        private IEnumerator OpenDevice()
        {
            yield return SessionClick("Settings"); yield return Idle();
            yield return SessionClick("Manage"); yield return Idle();
        }
        // Real first-hit EventSystem input. Scroll positioning is fixture setup,
        // not a claim of operating-system touch or swipe coverage.
        private IEnumerator SessionClick(string name)
        {
            var button = Find(name);
            Assert.That(button.interactable, Is.True, name);
            var scroll = host.GetComponent<PageShell>().Scroll; Canvas.ForceUpdateCanvases();
            var bounds = RectTransformUtility.CalculateRelativeRectTransformBounds(scroll.viewport, button.transform);
            float range = scroll.content.rect.height - scroll.viewport.rect.height;
            if (range > 0) scroll.verticalNormalizedPosition = 1 - Mathf.Clamp01((scroll.content.anchoredPosition.y + scroll.viewport.rect.center.y - bounds.center.y) / range);
            yield return null; Canvas.ForceUpdateCanvases();
            var rect = (RectTransform)button.transform;
            var point = RectTransformUtility.WorldToScreenPoint(null, rect.TransformPoint(rect.rect.center));
            var pointer = new PointerEventData(EventSystem.current) { position = point, button = PointerEventData.InputButton.Left };
            var hits = new List<RaycastResult>(); EventSystem.current.RaycastAll(pointer, hits);
            Assert.That(hits, Is.Not.Empty);
            Assert.That(ExecuteEvents.GetEventHandler<IPointerClickHandler>(hits[0].gameObject), Is.EqualTo(button.gameObject),
                name + " is under " + hits[0].gameObject.name + " (in " + hits[0].gameObject.transform.parent?.name + ")");
            pointer.pointerCurrentRaycast = hits[0]; pointer.pressPosition = point;
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerDownHandler);
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerUpHandler);
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerClickHandler);
        }
    }
}
