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
        [UnityTest] public IEnumerator OpeningSessionAndForegroundPreserveAnExistingPendingReceiptWithoutStatusRequests()
        {
            yield return PrepareScenario("pending-confirmed-failure"); Click("Connect"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            var exact = controller.LastReceipt;
            int before = environment.Calls.Count(call => call.Operation == "getSignatureStatuses");
            yield return OpenDevice();
            Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(controller.BrowsingCampaign, Is.False);
            StringAssert.Contains("An existing transaction needs checking", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enable device"), Is.False);
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Transaction receipt").text, Is.Not.Empty);
            controller.SendMessage("OnApplicationPause", true);
            controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(before));
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            environment.ConfirmPendingFailure(); yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedFailure));
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            Assert.That(controller.BrowsingSession, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DeviceAndCampaignNavigationKeepOneVisiblePanel()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            yield return OpenDevice();
            var controller = host.GetComponent<MoneyIdentity>().Controller; var views = host.GetComponent<PageViews>();
            Assert.That(views.ShownPanel, Is.EqualTo("Device"));
            yield return SessionClick("Back"); yield return Idle();
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
            Assert.That(ExecuteEvents.GetEventHandler<IPointerClickHandler>(hits[0].gameObject), Is.EqualTo(button.gameObject));
            pointer.pointerCurrentRaycast = hits[0]; pointer.pressPosition = point;
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerDownHandler);
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerUpHandler);
            ExecuteEvents.Execute(button.gameObject, pointer, ExecuteEvents.pointerClickHandler);
        }
    }
}
