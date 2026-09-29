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
        // Connect reads the owner and opens the Arcade; an empty transaction
        // check says so; Disconnect (from Settings) clears the owner at once.
        [UnityTest] public IEnumerator ActualConnectAndDisconnectButtonsShowBothSlotsWithoutBindingABoard()
        {
            yield return PrepareScenario("owner-overview");
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            StringAssert.Contains(System.DateTimeOffset.FromUnixTimeSeconds(environment.Clock()).ToString("dd MMM yyyy", System.Globalization.CultureInfo.InvariantCulture) + " · UTC", Text("Daily facts"));
            Assert.That(environment.Calls.Any(call => call.Operation == "authorize"), Is.False);
            Click("Connect"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.BrowsingDaily, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Resume Daily"), Is.True, "The saved Daily run is offered");
            var marker = environment.Services.RunMarkers.Load(environment.Owner); yield return Wait(marker);
            StringAssert.DoesNotContain(marker.GetAwaiter().GetResult().ActiveRun, SessionText());
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(true), Is.Empty);
            yield return Wait(controller.CheckTransaction()); yield return Idle();
            Assert.That(controller.LastReceipt, Is.Null);
            StringAssert.Contains("There is no transaction waiting to be checked", Text("Transaction receipt"));
            StringAssert.DoesNotContain("no-pending-transaction", Text("Transaction receipt"));
            Click("Settings"); yield return Idle();
            Click("Disconnect");
            Assert.That(controller.Status, Is.EqualTo("Disconnected"));
            Assert.That(controller.LastReceipt, Is.Null);
            yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Connect"), Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator ActualCheckButtonKeepsConfirmedFailureAfterTheJournalIsCleared()
        {
            yield return PrepareScenario("pending-confirmed-failure"); Click("Connect"); yield return Idle();
            StringAssert.Contains("Transaction pending", Text("Transaction receipt"));
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            environment.ConfirmPendingFailure(); Click("Check transaction"); yield return Idle();
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            var exact = controller.LastReceipt;
            Assert.That(exact.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(exact.ChainError, Is.Not.Empty);
            StringAssert.DoesNotContain(exact.ChainError, SessionText());
            var read = environment.Services.Journal.Load(environment.Owner); yield return Wait(read);
            Assert.That(read.GetAwaiter().GetResult(), Is.Null);
            yield return Wait(controller.RefreshOverview()); yield return Idle();
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator PauseInvalidatesDelayedOwnerPresentationAndForegroundNeverAuthorizes()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            delay = environment.HoldNextRead("getAccountInfo"); _ = controller.RefreshOverview(); yield return Wait(delay.Entered);
            controller.SendMessage("OnApplicationPause", true);
            Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
            delay.Release(); yield return null;
            controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Daily));
            Assert.That(environment.Calls.Count(call => call.Operation == "authorize"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator TeardownDuringDelayedReadWaitsWithoutLateInputOrSigning()
        {
            yield return PrepareScenario("owner-overview");
            delay = environment.HoldNextRead("getMultipleAccounts"); _ = host.GetComponent<MoneyIdentity>().Controller.RefreshOverview(); yield return Wait(delay.Entered);
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
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            delay = environment.HoldNextRead("getAccountInfo"); _ = controller.RefreshOverview();
            try
            {
                yield return Wait(delay.Entered);
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
                Assert.That(host.GetComponentsInChildren<TMP_Text>().Where(text => text.GetComponentInParent<LaunchScreen>() == null), Is.Empty,
                    "A late callback must not restore visible old content");
                int before = environment.Calls.Count(call => call.Operation == "getMultipleAccounts");
                controller.enabled = true; yield return Idle();
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Not.Empty);
                Assert.That(environment.Calls.Count(call => call.Operation == "getMultipleAccounts"), Is.GreaterThan(before));
                Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Daily));
                Assert.That(environment.Calls.Count(call => call.Operation == "authorize"), Is.EqualTo(1));
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { delay.Release(); }
        }
        private IEnumerator PrepareScenario(string scenario, float scale = 1, float? density = null)
        {
            var startup = Create();
            solana = new TextAsset(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            session = new TextAsset(ZKube.Integration.Tests.TestBootstrap.TokenJson);
            startup.Configuration.TextScale = scale; startup.Configuration.DisplayDensity = density ?? 0;
            var build = MoneyTestEnvironment.Create(scenario); yield return Wait(build);
            environment = build.GetAwaiter().GetResult(); ((MoneyIdentity)startup.Configuration.Identity).Configuration = new MoneyConfiguration {
                SolanaSchema = solana, SessionSchema = session, Services = environment.Services, Clock = environment.Clock };
            host.SetActive(true); yield return null;
            // Every guardian has greeted: the first-visit greeting is the store journey's to test.
            int greeted = ~0; var views = host.GetComponent<PageViews>();
            if (views != null) views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            yield return Idle();
            // A prepared app has drawn its first page and let its launch screen go.
            for (float end = Time.realtimeSinceStartup + 5; startup.Launch != null && Time.realtimeSinceStartup < end;) yield return null;
            Assert.That(startup.Launch == null, "The launch screen leaves once the first page is drawn");
            Assert.That(startup.LaunchWindowReleased, "The launch window's splash is released after the first frame");
        }
        // The page reflects the latest state once it has drawn.
        private IEnumerator Drawn()
        {
            float limit = Time.realtimeSinceStartup + 15;
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            while (controller.Drawing && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(controller.Drawing, Is.False, "The page did not draw");
        }
        // Larger text on a 360 x 640 phone: the Arcade grows past the screen and
        // scrolls under real drags from empty page space, and every action's
        // label fits its pill.
        [UnityTest] public IEnumerator LargerTextReflowsInsideScrollAndKeepsAllActionsReadable()
        {
            yield return PrepareScenario("owner-overview", 1.3f);
            host.GetComponent<PageShell>().Frame = new Rect(0, 0, 360, 640);
            Click("Connect"); yield return Idle();
            var shell = host.GetComponent<PageShell>(); var scroll = shell.Scroll;
            Canvas.ForceUpdateCanvases();
            Assert.That(scroll.content.rect.height, Is.GreaterThan(scroll.viewport.rect.height));
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
            // Every touch target keeps 48 dp; every pill's label stays on one line
            // (the kit's tab bar fits its own labels and has its own test).
            foreach (var button in host.GetComponentsInChildren<Button>())
                Assert.That(((RectTransform)button.transform).rect.height, Is.GreaterThanOrEqualTo(48), button.name);
            ZKube.Tests.Presentation.PageText.AssertPillLabelsOnOneLine(host.transform, "Arcade at larger text");
            yield return Wait(host.GetComponent<MoneyIdentity>().Controller.RefreshOverview()); yield return Idle();
            Assert.That(environment.ForbiddenCalls, Is.Zero);
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
        // A 440 dpi phone 280 and 320 dp wide, at larger text: every touch
        // target on the connect page and the Arcade is at least 48 dp.
        [UnityTest] public IEnumerator NarrowHighDensityCanvasKeepsPhysicalTouchTargetsAfterScaling()
        {
            const float density = 2.75f;
            yield return PrepareScenario("owner-overview", 1.3f, density);
            var controller = host.GetComponent<MoneyIdentity>().Controller; var shell = host.GetComponent<PageShell>();
            foreach (float logicalWidth in new[] { 280f, 320f })
            {
                shell.Frame = new Rect(0, 0, logicalWidth * density, 640 * density);
                if (environment.Services.Identity.Owner == null) { Click("Connect"); yield return Idle(); }
                else { yield return Wait(controller.RefreshOverview()); yield return Idle(); }
                foreach (var button in host.GetComponentsInChildren<Button>())
                {
                    var rect = SkinUi.ScreenRect((RectTransform)button.transform);
                    Assert.That(rect.height / density, Is.GreaterThanOrEqualTo(48 - .01), logicalWidth + "dp " + button.name);
                    Assert.That(rect.width / density, Is.GreaterThanOrEqualTo(48 - .01), button.name);
                }
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        private static bool PageDrawn(ZKube.Integration.Presentation.MoneyAppAdapter controller)
        {
            const System.Reflection.BindingFlags flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            return !controller.Busy && controller.isActiveAndEnabled && !controller.Drawing &&
                !(bool)controller.GetType().GetField("paused", flags).GetValue(controller);
        }
        private IEnumerator Idle()
        {
            float limit = Time.realtimeSinceStartup + 15;
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            // Input settles once its operation ends, its page is drawn and the page it replaced has left.
            System.Func<bool> settled = () => !controller.Busy && (!controller.isActiveAndEnabled || !controller.Drawing) &&
                !host.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page");
            while (!settled() && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(settled(), Is.True, "Overview input did not finish");
        }
        // A button by its name, or else by its one label: the tab bar's tabs.
        private Button Find(string name)
        {
            var buttons = host.GetComponentsInChildren<Button>();
            var named = buttons.Where(value => value.name == name).ToArray();
            if (named.Length != 0) return named.Single();
            var labelled = buttons.Where(value => value.GetComponentsInChildren<TMP_Text>().Any(text => text.text == name)).ToArray();
            Assert.That(labelled.Length, Is.EqualTo(1), "One button named or labelled " + name + " among " + string.Join(", ", buttons.Select(value => value.name)));
            return labelled[0];
        }
        private void Click(string name)
        {
            var button = Find(name);
            Assert.That(button.interactable, Is.True, name);
            ExecuteEvents.Execute(button.gameObject, new PointerEventData(EventSystem.current) { button = PointerEventData.InputButton.Left }, ExecuteEvents.pointerClickHandler);
        }
        private string Text(string name) => host.GetComponentsInChildren<TMP_Text>().Single(value => value.name == name).text;
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
                DisplayFont = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(SkinUi.Type.Number)),
                BodyFont = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(SkinUi.Type.Body)) };
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
