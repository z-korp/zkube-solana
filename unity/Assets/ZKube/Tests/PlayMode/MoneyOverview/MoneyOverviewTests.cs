using System.Collections;
using ZKube.Presentation;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.App.Tests;
using ZKube.Integration.Execution;
using ZKube.Integration.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private GameObject host, input;
        private TextAsset solana, session;
        private MoneyTestEnvironment environment;
        private HeldCall delay;
        [UnityTearDown] public IEnumerator Cleanup()
        {
            delay?.Release();
            if (host != null)
            {
                var startup = host.GetComponent<AppStartup>();
                if (startup != null) yield return Wait(startup.StopAsync());
                Object.Destroy(host);
            }
            if (input != null) Object.Destroy(input);
            if (solana != null) Object.Destroy(solana);
            if (session != null) Object.Destroy(session);
            yield return null;
        }
        [UnityTest] public IEnumerator ActualConnectAndDisconnectButtonsShowBothSlotsWithoutBindingABoard()
        {
            yield return PrepareScenario("owner-overview");
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            StringAssert.Contains(System.DateTimeOffset.FromUnixTimeSeconds(environment.Clock()).ToString("dd MMM yyyy", System.Globalization.CultureInfo.InvariantCulture) + " · UTC", Text("Daily facts"));
            Assert.That(environment.Calls.Any(call => call.Operation == "authorize"), Is.False);
            Click("Connect"); yield return Idle();
            StringAssert.Contains(environment.Owner, Text("Owner facts"));
            StringAssert.Contains("Campaign: No saved run", Text("Owner facts"));
            StringAssert.Contains("Daily: Run saved", Text("Owner facts"));
            var states = host.GetComponent<MoneyIdentity>().Controller.Flow.Owner.Value;
            StringAssert.DoesNotContain(states.Daily.Marker.ActiveRun, Text("Owner facts"));
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(true), Is.Empty);
            Click("Check transaction"); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt, Is.Null);
            StringAssert.Contains("There is no transaction waiting to be checked", Text("Transaction receipt"));
            StringAssert.DoesNotContain("no-pending-transaction", Text("Transaction receipt"));
            Click("Disconnect");
            Assert.That(Text("Owner facts"), Is.EqualTo("Disconnected"));
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt, Is.Null);
            yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ActualCheckButtonKeepsConfirmedFailureAfterTheJournalIsCleared()
        {
            yield return PrepareScenario("pending-confirmed-failure"); Click("Connect"); yield return Idle();
            StringAssert.Contains("Transaction pending", Text("Transaction receipt"));
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            environment.ConfirmPendingFailure(); Click("Check transaction"); yield return Idle();
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            var exact = host.GetComponent<MoneyIdentity>().Controller.LastReceipt;
            Assert.That(exact.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(exact.ChainError, Is.Not.Empty);
            StringAssert.DoesNotContain(exact.ChainError, Text("Transaction receipt"));
            var read = environment.Services.Journal.Load(environment.Owner); yield return Wait(read);
            Assert.That(read.GetAwaiter().GetResult(), Is.Null);
            Click("Refresh"); yield return Idle();
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator PauseInvalidatesDelayedOwnerPresentationAndForegroundNeverAuthorizes()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            delay = environment.HoldNextRead("getAccountInfo"); Click("Refresh"); yield return Wait(delay.Entered);
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            controller.SendMessage("OnApplicationPause", true);
            Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
            delay.Release(); yield return null;
            controller.SendMessage("OnApplicationPause", false); yield return Idle();
            StringAssert.Contains(environment.Owner, Text("Owner facts"));
            Assert.That(environment.Calls.Count(call => call.Operation == "authorize"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator TeardownDuringDelayedReadWaitsWithoutLateInputOrSigning()
        {
            yield return PrepareScenario("owner-overview");
            delay = environment.HoldNextRead("getMultipleAccounts"); Click("Refresh"); yield return Wait(delay.Entered);
            var stop = host.GetComponent<AppStartup>().StopAsync();
            Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
            Assert.That(stop.IsCompleted, Is.False);
            delay.Release(); yield return Wait(stop);
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ComponentDisableHidesInputAndReenableRefetchesAfterALateRead()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            delay = environment.HoldNextRead("getAccountInfo"); Click("Refresh");
            try
            {
                yield return Wait(delay.Entered);
                var controller = host.GetComponent<MoneyIdentity>().Controller;
                controller.enabled = false;
                Assert.That(host.activeInHierarchy, Is.True, "This case disables the component, not its GameObject");
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
                Assert.That(host.GetComponentsInChildren<Button>(), Is.Empty);
                Assert.That(PageDrawn(controller), Is.False);
                controller.SendMessage("OnApplicationPause", true);
                controller.SendMessage("OnApplicationPause", false);
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty, "Foreground resume cannot reactivate a disabled controller's canvas");
                Assert.That(PageDrawn(controller), Is.False);
                delay.Release(); yield return null;
                Assert.That(host.GetComponentsInChildren<TMP_Text>(), Is.Empty, "A late callback must not restore visible old content");
                int before = environment.Calls.Count(call => call.Operation == "getMultipleAccounts");
                controller.enabled = true; yield return Idle();
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Not.Empty);
                Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.GreaterThan(before));
                StringAssert.Contains(environment.Owner, Text("Owner facts"));
                Assert.That(environment.Calls.Count(call => call.Operation == "authorize"), Is.EqualTo(1));
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { delay.Release(); }
        }
        private IEnumerator PrepareScenario(string scenario, float scale = 1, float? density = null)
        {
            var startup = Create();
            solana = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            session = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
            startup.Configuration.TextScale = scale; startup.Configuration.DisplayDensity = density ?? 0;
            var build = MoneyTestEnvironment.Create(scenario); yield return Wait(build);
            environment = build.GetAwaiter().GetResult(); ((MoneyIdentity)startup.Configuration.Identity).Configuration = new MoneyConfiguration {
                SolanaSchema = solana, SessionSchema = session, Services = environment.Services, Clock = environment.Clock };
            host.SetActive(true); yield return null; yield return Idle();
        }
        [UnityTest] public IEnumerator LargerTextReflowsInsideScrollAndKeepsAllActionsReadable()
        {
            yield return PrepareScenario("owner-overview", 1.3f); Click("Connect"); yield return Idle();
            // Overflow is a property of this explicit short viewport, not the
            // incidental size of the Editor window running the test.
            var scroll = host.GetComponentInChildren<ScrollRect>();
            float width = scroll.viewport.rect.width;
            scroll.viewport.anchorMin = scroll.viewport.anchorMax = new Vector2(.5f, .5f);
            scroll.viewport.sizeDelta = new Vector2(width, 600);
            Canvas.ForceUpdateCanvases(); yield return null; Canvas.ForceUpdateCanvases();
            var facts = host.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Owner facts");
            facts.ForceMeshUpdate();
            Assert.That(facts.fontSize, Is.EqualTo(26).Within(.01));
            Assert.That(facts.textInfo.lineCount, Is.GreaterThan(4));
            Assert.That(facts.preferredHeight, Is.LessThanOrEqualTo(facts.rectTransform.rect.height + 1));
            Assert.That(scroll.content.rect.height, Is.GreaterThan(scroll.viewport.rect.height));
            // Empty viewport padding is a hit surface and routes real drags.
            var point = RectTransformUtility.WorldToScreenPoint(null, scroll.viewport.TransformPoint(
                new Vector3(scroll.viewport.rect.xMin + 2, scroll.viewport.rect.center.y, 0)));
            var pointer = new PointerEventData(EventSystem.current) { position = point, button = PointerEventData.InputButton.Left };
            var hits = new List<RaycastResult>(); EventSystem.current.RaycastAll(pointer, hits);
            Assert.That(hits, Is.Not.Empty);
            var drag = ExecuteEvents.GetEventHandler<IDragHandler>(hits[0].gameObject);
            Assert.That(drag, Is.EqualTo(scroll.gameObject));
            float start = scroll.content.anchoredPosition.y;
            ExecuteEvents.Execute(drag, pointer, ExecuteEvents.initializePotentialDrag);
            ExecuteEvents.Execute(drag, pointer, ExecuteEvents.beginDragHandler);
            pointer.position += Vector2.up * 120;
            ExecuteEvents.Execute(drag, pointer, ExecuteEvents.dragHandler);
            ExecuteEvents.Execute(drag, pointer, ExecuteEvents.endDragHandler);
            Assert.That(scroll.content.anchoredPosition.y, Is.GreaterThan(start));
            foreach (var button in host.GetComponentsInChildren<Button>())
            {
                var text = button.GetComponentInChildren<TMP_Text>(); text.ForceMeshUpdate();
                Assert.That(((RectTransform)button.transform).rect.height, Is.GreaterThanOrEqualTo(52));
                Assert.That(text.preferredHeight, Is.LessThanOrEqualTo(text.rectTransform.rect.height + 1), button.name);
                Assert.That(text.preferredWidth, Is.LessThanOrEqualTo(text.rectTransform.rect.width + 1), button.name);
            }
            scroll.verticalNormalizedPosition = 0; yield return null;
            Click("Refresh"); yield return Idle(); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator FreezeAndUtcRolloverEachRefreshOnceWithoutPolling()
        {
            yield return PrepareScenario("public-disconnected");
            var read = environment.Services.PublicDaily.Current(); yield return Wait(read);
            var daily = read.GetAwaiter().GetResult();
            Assert.That(daily.FreezesAt.HasValue, Is.True);
            long untilFreeze = daily.FreezesAt.Value - environment.Clock(); Assert.That(untilFreeze, Is.GreaterThan(0));
            int before = environment.Calls.Count(call => call.Operation == "getMultipleAccounts");
            environment.AdvanceClock(untilFreeze); yield return null; yield return Idle();
            StringAssert.Contains("Entries are closed", Text("Daily facts"));
            Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.EqualTo(before + 1));
            for (int i = 0; i < 5; i++) yield return null;
            Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.EqualTo(before + 1));
            environment.AdvanceClock((environment.Clock() / 86400 + 1) * 86400 - environment.Clock());
            yield return null; yield return Idle();
            StringAssert.Contains("Today's Daily is not available", Text("Daily facts"));
            Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.EqualTo(before + 2));
            for (int i = 0; i < 5; i++) yield return null;
            Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.EqualTo(before + 2));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator NarrowHighDensityCanvasKeepsPhysicalTouchTargetsAfterScaling()
        {
            const float density = 2.75f;
            yield return PrepareScenario("public-disconnected", 1.3f, density);
            var scaler = host.GetComponentInChildren<CanvasScaler>(); var canvas = scaler.GetComponent<Canvas>();
            foreach (float logicalWidth in new[] { 280f, 320f })
            {
                // Explicit 440dpi geometry fixtures: 770px/880px wide. The
                // viewport is synthetic; this does not claim device pixel proof.
                scaler.enabled = false; scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
                scaler.scaleFactor = logicalWidth * density / 430; scaler.enabled = true;
                var viewport = host.GetComponentInChildren<ScrollRect>().viewport;
                viewport.anchorMin = viewport.anchorMax = new Vector2(.5f, .5f);
                viewport.sizeDelta = new Vector2(390, 800);
                yield return null; yield return null; Canvas.ForceUpdateCanvases();
                foreach (var button in host.GetComponentsInChildren<Button>())
                {
                    var rect = (RectTransform)button.transform;
                    Assert.That(rect.rect.height * canvas.scaleFactor / density, Is.GreaterThanOrEqualTo(48 - .01), logicalWidth + "dp " + button.name);
                    Assert.That(rect.rect.width * canvas.scaleFactor / density, Is.GreaterThanOrEqualTo(48 - .01), button.name);
                }
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        private static bool PageDrawn(ZKube.Integration.Presentation.MoneyAppAdapter controller)
        {
            const System.Reflection.BindingFlags flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            return !controller.Busy && controller.isActiveAndEnabled &&
                !(bool)controller.GetType().GetField("paused", flags).GetValue(controller) &&
                !controller.GetComponent<ZKube.Presentation.AppShell>().Loading &&
                controller.GetComponentsInChildren<Image>().Where(image => image.name == "Guardian portrait").All(image => !image.enabled || image.sprite != null);
        }
        private IEnumerator Idle()
        {
            float limit = Time.realtimeSinceStartup + 15;
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            while (controller.Busy && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(controller.Busy, Is.False, "Overview input did not finish");
        }
        private void Click(string name)
        {
            var button = host.GetComponentsInChildren<Button>().Single(value => value.name == name);
            Assert.That(button.interactable, Is.True, name);
            ExecuteEvents.Execute(button.gameObject, new PointerEventData(EventSystem.current) { button = PointerEventData.InputButton.Left }, ExecuteEvents.pointerClickHandler);
        }
        private string Text(string name) => name == "Daily facts" ? string.Join("\n",
            host.GetComponentsInChildren<RectTransform>(true).Single(value => value.name == name).GetComponentsInChildren<TMP_Text>().Select(value => value.text)) :
            host.GetComponentsInChildren<TMP_Text>(true).Single(value => value.name == name).text;
        [UnityTest] public IEnumerator UnconfiguredSceneHasReadableTextAndNoEnabledOperation()
        {
            var startup = Create(); host.SetActive(true); yield return null;
            Assert.That(startup.UnavailableText, Is.EqualTo("Network configuration is unavailable."));
            Assert.That(host.GetComponent<MoneyIdentity>().Controller, Is.Null);
            Assert.That(host.GetComponentsInChildren<TMP_Text>(), Is.Not.Empty);
            Assert.That(host.GetComponentsInChildren<Button>(true).All(button => !button.interactable), Is.True);
            var text = host.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Unavailable status");
            Canvas.ForceUpdateCanvases(); text.ForceMeshUpdate();
            Assert.That(text.textInfo.characterCount, Is.GreaterThan(10));
            Assert.That(text.rectTransform.rect.width, Is.GreaterThan(0));
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(true), Is.Empty);
        }
        [UnityTest] public IEnumerator UnconfiguredSceneSurvivesPauseAndStopWithoutInventingAFlow()
        {
            var startup = Create(); host.SetActive(true); yield return null;
            startup.SendMessage("OnApplicationPause", true);
            startup.SendMessage("OnApplicationPause", false); yield return null;
            Assert.That(startup.UnavailableText, Is.EqualTo("Network configuration is unavailable."));
            yield return Wait(startup.StopAsync());
            Assert.That(host.GetComponentsInChildren<GraphicRaycaster>().Length, Is.Zero);
            Assert.That(host.GetComponent<MoneyIdentity>().Controller, Is.Null);
        }
        private AppStartup Create()
        {
            if (EventSystem.current == null) input = new GameObject("Money test input", typeof(EventSystem), typeof(StandaloneInputModule));
            host = new GameObject("Money standalone test"); host.SetActive(false);
            var startup = host.AddComponent<AppStartup>();
            startup.Configuration = new AppStartupConfiguration { Identity = host.AddComponent<MoneyIdentity>(),
                DisplayFont = Resources.Load<TMP_FontAsset>("ZKube/Fonts/LilitaOne-Regular"),
                BodyFont = Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular") };
            return startup;
        }
        internal static IEnumerator Wait(Task task)
        {
            float limit = Time.realtimeSinceStartup + 15;
            while (!task.IsCompleted && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(task.IsCompleted, Is.True, "Offline operation did not complete");
            if (task.IsFaulted) Assert.Fail(task.Exception.ToString());
            Assert.That(task.IsCanceled, Is.False);
        }
    }
}
