using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests
{
    public sealed class StoreAppPageJourneyTests
    {
        private sealed class Driver : ICampaignStoreDriver
        {
            public event Action<string> ProductFetched;
            public event Action<CampaignOrder[]> PurchasesFetched;
            public event Action<CampaignOrder> PurchasePaid;
            public event Action PurchaseDeferred;
            public event Action<bool> PurchaseRejected;
            public event Action<string, bool> PurchaseConfirmed;
            public event Action<string> QueryFailed;
            public event Action Disconnected;
            public string Failure;
            public Task Connect() => Task.CompletedTask;
            public void FetchProduct() { if (Failure != null) QueryFailed?.Invoke(Failure); else ProductFetched?.Invoke("€4.99"); }
            public void FetchPurchases() => PurchasesFetched?.Invoke(Array.Empty<CampaignOrder>());
            public void Purchase() => Assert.Fail("This UI journey must never invoke a purchase");
            public void Confirm(CampaignOrder _) => Assert.Fail("This UI journey must never acknowledge a purchase");
            public void Dispose() { }
        }
        private GameObject root;
        private StoreAppAdapter app;
        private BoardController board;
        private CampaignBilling billing;
        private LocalProductStore product;
        private StoreRunClient runs;
        private bool failSave;
        private int greeted;
        private readonly Dictionary<string, float> audio = new Dictionary<string, float>();

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Isolated store page journey");
            if (EventSystem.current == null)
                new GameObject("Shared test EventSystem", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var boardRoot = new GameObject("Store test board"); boardRoot.transform.SetParent(root.transform);
            board = boardRoot.AddComponent<BoardController>();
            // Avoid touching real preferences. The production private field is
            // the concrete AudioPreferences dependency; no new runtime seam.
            audio.Clear(); audio[AudioPolicy.MusicKey] = 0; audio[AudioPolicy.EffectsKey] = .4f;
            typeof(BoardController).GetField("audioPreferences", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(board,
                new AudioPreferences((key, fallback) => audio.TryGetValue(key, out var value) ? value : fallback, (key, value) => audio[key] = value));
            typeof(BoardController).GetProperty("Muted").SetValue(board, true);
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, true);
            typeof(BoardController).GetProperty("Haptics").SetValue(board, false);
            typeof(BoardController).GetProperty("TextScale").SetValue(board, 1f);
            failSave = false;
            product = new LocalProductStore(_ => null, (_, __) => { if (failSave) throw new InvalidOperationException("Injected save failure"); });
            runs = new StoreRunClient(product, () => 20705L * 86400);
            billing = new CampaignBilling(new Driver(), () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board);
            // Every guardian has greeted unless a test asks for the first visit.
            greeted = ~0; Greet(app);
            yield return Page(StorePage.Daily);
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            if (root != null) UnityEngine.Object.Destroy(root);
            yield return null; billing?.Dispose(); billing = null;
            LogAssert.NoUnexpectedReceived();
        }
        private void Greet(StoreAppAdapter target) =>
            target.GetComponent<PageViews>().Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
        private static Button FindButton(Component parent, string name)
        {
            var choices = parent.GetComponentsInChildren<Button>().Where(value => value.gameObject.activeInHierarchy);
            var exactText = choices.Where(value => value.GetComponentsInChildren<TMP_Text>().Any(text => text.text == name)).ToArray();
            if (exactText.Length == 1) return exactText[0];
            var exactName = choices.Where(value => value.name == name).ToArray();
            Assert.That(exactName.Length, Is.EqualTo(1), "Expected one active button: " + name);
            return exactName[0];
        }
        private static void Click(Component parent, string name)
        {
            var button = FindButton(parent, name); Assert.That(button.interactable, Is.True, name); button.onClick.Invoke();
        }
        private IEnumerator Wait(Func<bool> predicate, string reason)
        {
            float deadline = Time.realtimeSinceStartup + 30;
            while (!predicate()) { if (Time.realtimeSinceStartup > deadline) Assert.Fail(reason); yield return null; }
            yield return null;
        }
        private bool PageDrawn() => !(bool)typeof(StoreAppAdapter).GetField("dirty", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) &&
            !(bool)typeof(StoreAppAdapter).GetField("loading", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) &&
            app.GetComponentsInChildren<Image>().Where(image => image.name == "Guardian portrait").All(image => image.enabled && image.sprite != null);
        private IEnumerator Page(StorePage page) => Wait(() => app != null && app.Flow.Page == page && PageDrawn(), "Page did not become ready: " + page);
        private IEnumerator BoardReady() => Wait(() => board != null && ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy, "Board did not become ready: " + "Board is still busy or loading");
        private IEnumerator NamePlayer()
        {
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            Click(app, "Edit name"); yield return null;
            var field = app.GetComponentInChildren<TMP_InputField>(); field.text = "  Page tester  ";
            Click(app, "Save name"); yield return Page(StorePage.Profile);
            Click(app, "Daily"); yield return Page(StorePage.Daily);
        }
        private IEnumerator EndRun()
        {
            Click(board.View, "Pause"); Click(board.View, "End run");
            yield return null; Click(board.View, "End run");
            yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, "Run did not end");
        }
        private bool WarningVisible => app.GetComponentsInChildren<TMP_Text>().Any(text => text.gameObject.activeInHierarchy && text.text.StartsWith("Progress is not saved."));

        [UnityTest] public IEnumerator StandaloneDailyDrawsVisiblePixelsWithoutInheritedSceneRendering()
        {
            // A ready component tree is insufficient: a packaged Store scene
            // must submit visible UI without a board/test-scene camera.
            var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
            var canvases = UnityEngine.Object.FindObjectsByType<Canvas>(FindObjectsSortMode.None);
            var cameraStates = cameras.Select(value => value.enabled).ToArray();
            var canvasStates = canvases.Select(value => value.enabled).ToArray();
            GameObject clear = null;
            Texture2D pixels = null;
            try
            {
                foreach (var camera in cameras) camera.enabled = false;
                foreach (var canvas in canvases) canvas.enabled = false;
                clear = new GameObject("Clear inherited framebuffer", typeof(Camera));
                var clearingCamera = clear.GetComponent<Camera>();
                clearingCamera.clearFlags = CameraClearFlags.SolidColor;
                clearingCamera.backgroundColor = Color.black; clearingCamera.cullingMask = 0;
                yield return new WaitForEndOfFrame();
                clearingCamera.enabled = false;
                for (int n = 0; n < cameras.Length; n++)
                    if (cameras[n].transform.IsChildOf(root.transform)) cameras[n].enabled = cameraStates[n];
                for (int n = 0; n < canvases.Length; n++)
                    if (canvases[n].transform.IsChildOf(root.transform)) canvases[n].enabled = canvasStates[n];
                yield return null;
                yield return new WaitForEndOfFrame();
                pixels = new Texture2D(Screen.width, Screen.height, TextureFormat.RGBA32, false);
                pixels.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0);
                pixels.Apply();
                var colors = pixels.GetPixels32();
                int visible = colors.Count(value => Math.Max(value.r, Math.Max(value.g, value.b)) > 24);
                Assert.That(visible, Is.GreaterThan(colors.Length / 20),
                    "Store reports ready but its standalone frame is blank");
            }
            finally
            {
                if (pixels != null) UnityEngine.Object.Destroy(pixels);
                if (clear != null) UnityEngine.Object.Destroy(clear);
                for (int n = 0; n < cameras.Length; n++) if (cameras[n] != null) cameras[n].enabled = cameraStates[n];
                for (int n = 0; n < canvases.Length; n++) if (canvases[n] != null) canvases[n].enabled = canvasStates[n];
            }
        }

        [UnityTest] public IEnumerator StoreStartsWithDefaultNameAndEditsItInProfile()
        {
            Assert.That(product.Read.Name, Is.EqualTo(LocalProductCodec.DefaultName));
            Assert.That(FindButton(app, "Play today").interactable, Is.True);
            var leases = (System.Collections.IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var common = leases["ZKube/Atlases/common"];
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            Click(app, "Edit name"); yield return null;
            var field = app.GetComponentInChildren<TMP_InputField>(); field.onSubmit.Invoke(" \t ");
            yield return Page(StorePage.Profile);
            Assert.That(product.Read.Name, Is.EqualTo(LocalProductCodec.DefaultName));
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Enter a name"), Is.True);
            Click(app, "Edit name"); yield return null;
            field = app.GetComponentInChildren<TMP_InputField>(); field.text = "  Page tester  ";
            Click(app, "Save name"); yield return Page(StorePage.Profile);
            Assert.That(product.Read.Name, Is.EqualTo("Page tester"));
            Click(app, "Daily"); yield return Page(StorePage.Daily);
            Assert.That(FindButton(app, "Play today").interactable, Is.True);
            Assert.That(leases["ZKube/Atlases/common"], Is.SameAs(common));
        }
        // A finished run holds on the board for a moment, then its result page opens.
        [UnityTest] public IEnumerator PageButtonBindsLocalBoardAndTerminalOpensTheResultPage()
        {
            yield return NamePlayer(); byte realm = runs.Today().Realm;
            Click(app, "Play today"); yield return BoardReady();
            Assert.That(board.Session.RealmId, Is.EqualTo(realm)); Assert.That(ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId, Is.EqualTo(realm));
            Assert.That(product.Read.DailyAttempt.DayId, Is.EqualTo(runs.Today().DayId));
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(board.gameObject.activeSelf, Is.False); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
            Assert.That(app.Flow.LastCampaign, Is.Null);
            Click(app, "Daily"); yield return Page(StorePage.Daily);
            // A used Daily gives its reason where Play was, never a greyed-out
            // Play, counts to the next Daily and shows the run; the result is the
            // action left to take, so it is the primary.
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Play today")), Is.False);
            Assert.That(Texts(), Does.Contain("Today’s attempt is used").And.Contain("Next Daily in 24:00:00"));
            Assert.That(Texts(), Does.Contain("Score").And.Contain(product.Read.DailyAttempt.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)));
            var result = FindButton(app, "View result");
            Assert.That(result.interactable, Is.True);
            Assert.That(result.GetComponent<Image>().sprite.name, Does.StartWith(SkinSlots.ButtonPrimary));
        }
        // A store that cannot be reached at startup does not greet the player on
        // the Daily; its notice appears where purchase and restore are.
        [UnityTest] public IEnumerator StartupStoreFailureStaysOffTheDailyAndShowsWithRestore()
        {
            UnityEngine.Object.Destroy(app.gameObject); yield return null; billing.Dispose();
            billing = new CampaignBilling(new Driver { Failure = "Purchases are unavailable" },
                () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board); Greet(app);
            yield return Wait(() => app.Flow.BillingNotice == "Purchases are unavailable" && !billing.Busy, "Startup store query did not fail");
            yield return Page(StorePage.Daily);
            Assert.That(app.Flow.Error, Is.Null);
            Assert.That(Texts(), Does.Not.Contain("Purchases are unavailable"));
            Assert.That(FindButton(app, "Play today").interactable, Is.True);
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Restore purchases");
            yield return Wait(() => app.Flow.BillingNotice == "Purchases are unavailable" && !billing.Busy, "Restore did not report the store failure");
            yield return Page(StorePage.Settings);
            Assert.That(Texts(), Does.Contain("Purchases are unavailable"));
        }
        // Presses a kit slider at a fraction of its track, as a finger would.
        private void Slide(string name, float fraction)
        {
            var slider = app.GetComponentsInChildren<SkinSlider>().Single(value => value.name == name);
            var track = SkinUi.ScreenRect((RectTransform)slider.transform.Find(name + " track"));
            slider.OnPointerDown(new PointerEventData(EventSystem.current) { position = new Vector2(track.x + track.width * fraction, track.center.y) });
        }
        // The name is edited in place: Save appears only once it differs, the
        // preview follows it, and saving closes the editor.
        [UnityTest] public IEnumerator ProfileEditsTheNameInPlaceAndOffersSaveOnlyAfterAChange()
        {
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            Assert.That(app.GetComponentInChildren<TMP_InputField>(), Is.Null);
            Click(app, "Edit name"); yield return null;
            Assert.That(Buttons().Any(button => button.name == "Save name"), Is.False, "Nothing to save yet");
            var field = app.GetComponentInChildren<TMP_InputField>(); field.text = "River"; yield return null;
            Assert.That(FindButton(app, "Save name").interactable, Is.True);
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Name preview").text, Is.EqualTo("River"),
                "The preview shows the new name");
            Click(app, "Save name"); yield return Page(StorePage.Profile);
            Assert.That(product.Read.Name, Is.EqualTo("River"));
            Assert.That(app.GetComponentInChildren<TMP_InputField>(), Is.Null);
            Assert.That(FindButton(app, "Edit name").interactable, Is.True);
        }
        // Every emblem is shown; only an unlocked one can be worn, and wearing it
        // is said beside the name.
        [UnityTest] public IEnumerator EmblemGridShowsEveryEmblemAndWearsOnlyUnlockedOnes()
        {
            product.Write(state => { state.Stars[9] = 1; return state; });
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            foreach (var emblem in ProfileEmblems.All.Where(emblem => emblem.Id != 0))
                Assert.That(Texts(), Does.Contain(emblem.Name));
            Assert.That(Buttons().Any(button => button.name == "Emblem 2"), Is.False, "A locked emblem takes no tap");
            Click(app, "Emblem 1"); yield return Page(StorePage.Profile);
            Assert.That(product.Read.WornEmblem, Is.EqualTo(1));
            Assert.That(Texts(), Does.Contain("Wearing Mako"));
        }
        private Button[] Buttons() => app.GetComponentsInChildren<Button>().Where(value => value.gameObject.activeInHierarchy).ToArray();
        private string[] Texts() => app.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy).Select(text => text.text).ToArray();
        [UnityTest] public IEnumerator CampaignPageHasAuthoredNodesAndRealPreviewHandler()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            var nodes = Nodes(); Assert.That(nodes.Length, Is.EqualTo(10));
            AssertNodeCaptions(nodes);
            // Dragging empty map space must reach the ScrollRect as dragging a
            // button does. A decorative backdrop outside it cannot provide this.
            var scroll = app.GetComponentInChildren<ScrollRect>();
            var point = RectTransformUtility.WorldToScreenPoint(null, scroll.viewport.TransformPoint(
                new Vector3(scroll.viewport.rect.xMin + 2, scroll.viewport.rect.center.y, 0)));
            var pointer = new PointerEventData(EventSystem.current) { position = point };
            var hits = new List<RaycastResult>(); EventSystem.current.RaycastAll(pointer, hits);
            Assert.That(hits.Count, Is.GreaterThan(0));
            Assert.That(ExecuteEvents.GetEventHandler<IDragHandler>(hits[0].gameObject), Is.EqualTo(scroll.gameObject));
            // The Campaign header holds the realm arrows; settings open from the other tabs.
            Click(app, "Daily"); yield return Page(StorePage.Daily);
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Text size: standard"); yield return Page(StorePage.Settings);
            // Settings has no tab bar; its back button returns to the tab it was opened from.
            Click(app, "Back"); yield return Page(StorePage.Daily);
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            nodes = Nodes();
            AssertNodeCaptions(nodes);
            var first = nodes.Single(button => button.name == "Trial 1"); Assert.That(first.interactable, Is.True);
            Assert.That(nodes.Single(button => button.name == "Trial 2").interactable, Is.False);
            first.onClick.Invoke(); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady(); Assert.That(board.Session.RealmId, Is.EqualTo(1));
        }
        [UnityTest] public IEnumerator CampaignRunOpensItsResultAndRetryReplaysTheSameLevel()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            // The preview words every goal from its constraint and shows its target
            // (there is no progress yet), with the guardian's rule and what its bonus
            // does; no internal source names.
            var level = Protocol.Realms[0].Levels[0]; var catalog = PageCatalog.Load(); var rule = catalog.Rule(1);
            app.GetComponentInChildren<GuardianTalk>().Complete();
            var texts = Texts();
            Assert.That(texts, Does.Contain("Score").And.Contain(Protocol.CampaignTargets[0].ToString("N0", System.Globalization.CultureInfo.InvariantCulture)));
            Assert.That(texts, Does.Contain(catalog.ObjectiveName(level.Primary[0], level.Primary[1], level.Primary[2])).And.Contain(level.Primary[2].ToString()));
            Assert.That(texts, Does.Contain(catalog.ObjectiveName(level.Secondary[0], level.Secondary[1], level.Secondary[2])));
            Assert.That(texts, Does.Contain("EARN " + rule.name.ToUpperInvariant()).And.Contain(rule.description + "\n" + rule.effect)
                .And.Contain(catalog.Realm(1).guardianLines.greeting).And.Contain(catalog.Realm(1).guardianTitle));
            Assert.That(texts.Any(text => text.StartsWith("0 / ")), Is.False);
            Assert.That(texts.Where(text => text != null).Any(text => new[] { "Theme", "Shape", "Blow", "★", "☆" }.Any(text.Contains)), Is.False);
            Click(app, "Play"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            var outcome = app.Flow.LastCampaign;
            Assert.That(outcome, Is.Not.Null); Assert.That(outcome.Realm, Is.EqualTo(1)); Assert.That(outcome.Level, Is.EqualTo(1));
            Assert.That(outcome.EndReason, Is.EqualTo(3));
            // The guardian says how it went; an ended run lights no star.
            Assert.That(Texts(), Does.Contain("Run ended").And.Contain("An ended run keeps no stars · try again")
                .And.Contain(catalog.Realm(1).guardianLines.incomplete));
            var sockets = app.GetComponentsInChildren<Image>().Where(image => image.name.StartsWith("Result star ")).ToArray();
            Assert.That(sockets.Length, Is.EqualTo(3));
            Assert.That(sockets.All(image => image.sprite.name.StartsWith(SkinSlots.StarOff)), Is.True);
            Click(app, "Retry"); yield return BoardReady();
            Assert.That(board.Session.RealmId, Is.EqualTo(1)); Assert.That(runs.Active("campaign").Level, Is.EqualTo(1));
            yield return EndRun(); yield return Page(StorePage.Result);
            Click(app, "Map"); yield return Page(StorePage.Campaign);
        }
        // The home Campaign card follows the furthest realm the core progression opens.
        [UnityTest] public IEnumerator HomeCampaignCardShowsTheFurthestOpenRealm()
        {
            product.Write(state => { state.Stars[9] = 1; state.Stars[19] = 2; return state; });
            var summary = app.CampaignSummary();
            Assert.That(summary.Realm, Is.EqualTo(3)); Assert.That(summary.Stars, Is.Zero);
            yield return Page(StorePage.Daily);
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Realm 3 / 10"), Is.True);
            Assert.That(app.GetComponentsInChildren<Image>().Single(image => image.name == "Wordmark").sprite.name, Does.StartWith("brand__realms"));
            Click(app, "Explore map"); yield return Page(StorePage.Campaign);
            Assert.That(app.Flow.Realm, Is.EqualTo(3));
        }
        // At the larger text size on a 360 x 640 phone, Home is taller than the
        // space between the wordmark's top and the tab bar; it scrolls, and every
        // panel and action comes fully into view above the tab bar.
        [UnityTest] public IEnumerator LargeTextHomeScrollsFullyIntoViewOnACompactPhone()
        {
            var shell = app.GetComponent<PageShell>();
            shell.Frame = new Rect(0, 0, 360, 640);
            try
            {
                typeof(BoardController).GetProperty("TextScale").SetValue(board, 1.3f);
                Click(app, "Profile"); yield return Page(StorePage.Profile);
                Click(app, "Daily"); yield return Page(StorePage.Daily);
                var viewport = SkinUi.ScreenRect(shell.Viewport);
                var tabs = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
                Assert.That(viewport.yMin, Is.GreaterThanOrEqualTo(tabs.yMax - .5f));
                Assert.That(viewport.yMax, Is.LessThanOrEqualTo(640.5f));
                Assert.That(shell.Scroll.content.rect.height, Is.GreaterThan(viewport.height), "Home should scroll at this size");
                Rect Of(Component value) => SkinUi.ScreenRect((RectTransform)value.transform);
                void Inside(Component value)
                {
                    var rect = Of(value);
                    Assert.That(rect.yMin, Is.GreaterThanOrEqualTo(viewport.yMin - .5f), value.name + " stays under the tab bar");
                    Assert.That(rect.yMax, Is.LessThanOrEqualTo(viewport.yMax + .5f), value.name + " runs above the page");
                    Assert.That(rect.xMin, Is.GreaterThanOrEqualTo(-.5f), value.name); Assert.That(rect.xMax, Is.LessThanOrEqualTo(360.5f), value.name);
                }
                var images = app.GetComponentsInChildren<Image>();
                Inside(images.Single(image => image.name == "Wordmark"));
                Inside(images.Single(image => image.name == "Daily card"));
                shell.Scroll.verticalNormalizedPosition = 0; Canvas.ForceUpdateCanvases(); yield return null;
                Inside(images.Single(image => image.name == "Campaign card"));
                Inside(FindButton(app, "Explore map"));
            }
            finally { shell.Frame = null; }
        }
        // The first visit to a realm's map greets once: the guardian's line, then
        // its rule and what the bonus does. A tap continues, and it does not return.
        [UnityTest] public IEnumerator FirstVisitToARealmGreetsOnceWithTheLineAndTheRule()
        {
            greeted = 0; yield return NamePlayer();
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            var catalog = PageCatalog.Load(); var rule = catalog.Rule(1);
            app.GetComponentInChildren<GuardianTalk>().Complete();
            Assert.That(Texts(), Does.Contain(catalog.Realm(1).guardianLines.greeting).And.Contain("EARN " + rule.name.ToUpperInvariant()).And.Contain(rule.description + "\n" + rule.effect));
            Click(app, "Continue"); yield return null;
            Assert.That(Texts(), Does.Not.Contain(catalog.Realm(1).guardianLines.greeting));
            Assert.That(new GuardianGreetings(() => greeted, _ => { }).Greeted(1), Is.True);
            Click(app, "Daily"); yield return Page(StorePage.Daily);
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Assert.That(Texts(), Does.Not.Contain(catalog.Realm(1).guardianLines.greeting));
        }
        // The map repeats the current level's action as its primary; realm 1 has no
        // realm before it, so its back arrow is not drawn.
        [UnityTest] public IEnumerator MapPrimaryPlaysTheCurrentLevelAndUnavailableArrowsAreNotDrawn()
        {
            product.Write(state => { state.Stars[0] = 3; state.Stars[1] = 2; return state; });
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Assert.That(Buttons().Any(button => button.name == "Previous"), Is.False);
            Assert.That(FindButton(app, "Next").interactable, Is.True);
            Click(app, "Play · Level 3"); yield return Page(StorePage.Level);
            Assert.That(app.Flow.Level, Is.EqualTo(3));
            Assert.That(Texts(), Does.Contain("Level 3"));
        }
        // Another realm is another page: on a phone where the map scrolls, it opens
        // on its own current level, never at the scroll the last realm was left at.
        [UnityTest] public IEnumerator SwitchingRealmsOpensTheNewMapAtItsCurrentLevel()
        {
            product.Write(state => { state.Stars[9] = 1; return state; });
            var shell = app.GetComponent<PageShell>();
            shell.Frame = new Rect(0, 0, 360, 640);
            try
            {
                yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
                Click(app, "Next"); yield return Page(StorePage.Campaign);
                Assert.That(app.Flow.Realm, Is.EqualTo(2));
                float opened = shell.Offset;
                Assert.That(opened, Is.GreaterThan(0), "The current level sits low on a scrolling map");
                Click(app, "Previous"); yield return Page(StorePage.Campaign);
                shell.Offset = 0;
                Click(app, "Next"); yield return Page(StorePage.Campaign);
                Assert.That(shell.Offset, Is.EqualTo(opened).Within(1));
            }
            finally { shell.Frame = null; }
        }
        // A realm the progression has not opened says why and leads back; a realm
        // behind the store's purchase offers it and restore, and says so when the
        // store cannot be reached, with a retry in its place.
        [UnityTest] public IEnumerator LockedRealmsSayWhyAndOfferTheWayForward()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Next"); yield return Page(StorePage.Campaign);
            Assert.That(app.Flow.Realm, Is.EqualTo(2));
            Assert.That(Nodes(), Is.Empty);
            Assert.That(Texts(), Does.Contain("The path is waiting").And.Contain("Clear Mako’s final trial in Tiki to open Egypt."));
            Click(app, "Return to Tiki"); yield return Page(StorePage.Campaign);
            Assert.That(app.Flow.Realm, Is.EqualTo(1));
            product.Write(state => { state.Stars[9] = 1; state.Stars[19] = 1; state.Stars[29] = 1; return state; });
            app.Flow.SelectRealm(4); yield return Page(StorePage.Campaign);
            Assert.That(Texts(), Does.Contain("Realms 4–10 open with the full Campaign purchase."));
            Assert.That(FindButton(app, "Restore purchases").interactable, Is.True);
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text.StartsWith("Unlock full Campaign"))), Is.True);
            var failing = new CampaignBilling(new Driver { Failure = "Purchases are unavailable" },
                () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            UnityEngine.Object.Destroy(app.gameObject); yield return null; billing.Dispose(); billing = failing;
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board); Greet(app);
            yield return Wait(() => app.Flow.StoreUnavailable && !billing.Busy, "The store query did not fail");
            app.Flow.SelectRealm(4); yield return Page(StorePage.Campaign);
            Assert.That(Texts(), Does.Contain("Store purchase unavailable").And.Contain("Check your connection and try again."));
            Assert.That(FindButton(app, "Try again").interactable, Is.True);
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text.StartsWith("Unlock full Campaign"))), Is.False);
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Restore purchases")), Is.False);
        }
        // A result arrives in beats and a tap anywhere skips to its end: until then
        // its actions wait; after, the score is final and the actions are live.
        // Reduced motion shows the end state at once.
        [UnityTest] public IEnumerator ResultEntranceIsSkippableAndReducedMotionShowsTheEndState()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady();
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            yield return EndRun(); yield return Page(StorePage.Result);
            var retry = FindButton(app, "Retry");
            Assert.That(retry.IsInteractable(), Is.False, "Actions arrive last");
            FindButton(app, "Skip").onClick.Invoke(); yield return null;
            Assert.That(retry.IsInteractable(), Is.True);
            Assert.That(Buttons().Any(button => button.name == "Skip"), Is.False);
            Assert.That(Texts(), Does.Contain(app.Flow.LastCampaign.Score.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)));
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, true);
            Click(app, "Retry"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(FindButton(app, "Retry").IsInteractable(), Is.True);
            Assert.That(Buttons().Any(button => button.name == "Skip"), Is.False);
        }
        // The Daily result: the guardian's line, the score, the day's objective
        // count and the streak, with sharing as the primary.
        [UnityTest] public IEnumerator DailyResultShowsTheScoreObjectiveAndStreakWithSharing()
        {
            app.Flow.Show(StorePage.Daily); yield return Page(StorePage.Daily);
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            var today = runs.Today(); var catalog = PageCatalog.Load();
            var texts = Texts();
            Assert.That(texts, Does.Contain("Daily complete").And.Contain(catalog.Realm(today.Realm).guardianLines.dailyGreeting).And.Contain("SCORE").And.Contain("DAILY STREAK"));
            if (today.ObjectiveKind != 0) Assert.That(texts, Does.Contain(catalog.ObjectiveName(today.ObjectiveKind, today.ObjectiveValue)));
            var share = FindButton(app, "Share result");
            Assert.That(share.GetComponent<Image>().sprite.name, Does.StartWith(SkinSlots.ButtonPrimary));
        }
        // A page change sends the old page leaving on its own layer, which takes
        // no input and fades, raises the new one within the spec's budget, and
        // leaves the tab bar where it was.
        [UnityTest] public IEnumerator PageChangeLeavesWithoutInputEntersInBudgetAndKeepsTheTabBarStill()
        {
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            var shell = app.GetComponent<PageShell>();
            var leaving = shell.Overlay.parent.GetComponent<CanvasGroup>();
            var bar = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
            Assert.That(shell.Chrome.IsChildOf(leaving.transform), Is.False);
            Click(app, "Profile"); yield return null;
            Assert.That(leaving.blocksRaycasts, Is.False);
            yield return null; Assert.That(leaving.alpha, Is.LessThan(1));
            float start = Time.unscaledTime;
            yield return Page(StorePage.Profile);
            var stage = shell.Overlay.parent.GetComponent<CanvasGroup>();
            Assert.That(stage, Is.Not.SameAs(leaving));
            yield return Wait(() => leaving == null && stage.alpha == 1 && stage.blocksRaycasts && ((RectTransform)stage.transform).anchoredPosition.y == 0,
                "The page did not settle");
            Assert.That(Time.unscaledTime - start, Is.LessThan(PageShell.LeaveSeconds + PageShell.GlowSeconds + .2f));
            Assert.That(SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform), Is.EqualTo(bar));
        }
        // No drawn piece loses its art while pages change: across every tab and
        // realm change that loads art (another realm's painting, the portrait
        // atlas), each visible image keeps a live sprite on every frame, the
        // leaving page included. A piece drawn without art may only be a dark
        // scrim; a pale block is art released under a visible page.
        [UnityTest] public IEnumerator EveryPageAndRealmChangeKeepsEachVisiblePiecesArtOnEveryFrame()
        {
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            // Realm 2 is still closed, so its page is the waiting realm, drawn from its own art.
            var steps = new[] { ("Campaign", StorePage.Campaign), ("Next", StorePage.Campaign), ("Previous", StorePage.Campaign),
                ("Next", StorePage.Campaign), ("Previous", StorePage.Campaign), ("Trial 1", StorePage.Level), ("Back to map", StorePage.Campaign),
                ("Profile", StorePage.Profile), ("Settings", StorePage.Settings), ("Back", StorePage.Profile), ("Daily", StorePage.Daily),
                ("Campaign", StorePage.Campaign), ("Profile", StorePage.Profile), ("Daily", StorePage.Daily) };
            var shown = app.GetComponent<PageShell>().Artwork; int swaps = 0;
            foreach (var (control, page) in steps)
            {
                Click(app, control);
                float deadline = Time.realtimeSinceStartup + 30;
                do
                {
                    yield return null;
                    AssertEveryVisiblePieceHasArt(control);
                    if (Time.realtimeSinceStartup > deadline) Assert.Fail("Page did not settle after " + control);
                }
                while (app.Flow.Page != page || !PageDrawn() || app.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page"));
                var art = app.GetComponent<PageShell>().Artwork;
                if (art != shown) { swaps++; shown = art; }
            }
            Assert.That(swaps, Is.GreaterThanOrEqualTo(4), "The walk must cross realm art loads");
        }
        // On a compact phone and at Seeker size no visible part of any map node,
        // its label or its stars ever touches the page header, in every realm,
        // wherever the map opens.
        [UnityTest] public IEnumerator MapNodesNeverReachTheHeaderOnCompactOrSeekerPhones()
        {
            product.Write(state => {
                state.CampaignOwned = true;
                for (int realm = 0; realm < Protocol.Realms.Length; realm++)
                    for (int level = 0; level < 5; level++) state.Stars[realm * 10 + level] = (byte)(level % 3 + 1);
                for (int realm = 0; realm < Protocol.Realms.Length; realm++) state.Stars[realm * 10 + 9] = 1;
                return state;
            });
            var shell = app.GetComponent<PageShell>();
            foreach (var frame in new[] { new Rect(0, 0, 360, 640), new Rect(0, 0, 400, 890) })
            {
                shell.Frame = frame;
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    app.Flow.SelectRealm(realm); yield return Page(StorePage.Campaign);
                    var header = Rect.MinMaxRect(frame.xMin, frame.yMax - 84, frame.xMax, frame.yMax);
                    var viewport = SkinUi.ScreenRect(shell.Viewport);
                    var nodes = Nodes();
                    Assert.That(nodes.Length, Is.EqualTo(10), frame.width + " realm " + realm);
                    foreach (var node in nodes)
                        foreach (var piece in node.GetComponentsInChildren<Graphic>().Where(graphic => graphic.gameObject != node.gameObject &&
                            !graphic.name.EndsWith(" glow") && graphic.color.a > 0))
                        {
                            var rect = SkinUi.ScreenRect(piece.rectTransform);
                            var shown = Rect.MinMaxRect(Mathf.Max(rect.xMin, viewport.xMin), Mathf.Max(rect.yMin, viewport.yMin),
                                Mathf.Min(rect.xMax, viewport.xMax), Mathf.Min(rect.yMax, viewport.yMax));
                            if (shown.width <= 0 || shown.height <= 0) continue;
                            Assert.That(shown.yMax, Is.LessThanOrEqualTo(header.yMin + .5f), frame.width + " realm " + realm + ": " + piece.name + " reaches the header");
                        }
                }
            }
            shell.Frame = null;
        }
        // On a compact phone every page's last piece scrolls fully above the tab
        // bar (or the screen's bottom where there is no tab bar).
        [UnityTest] public IEnumerator EveryPagesLastPieceScrollsAboveTheTabBarOnACompactPhone()
        {
            var shell = app.GetComponent<PageShell>();
            shell.Frame = new Rect(0, 0, 360, 640);
            product.Write(state => { state.Stars[0] = 3; state.Stars[9] = 1; return state; });
            foreach (var textScale in new[] { 1f, 1.3f })
            {
                typeof(BoardController).GetProperty("TextScale").SetValue(board, textScale);
                foreach (var (control, page) in new[] { ("Daily", StorePage.Daily), ("Campaign", StorePage.Campaign), ("Profile", StorePage.Profile),
                    ("Settings", StorePage.Settings) })
                {
                    if (app.Flow.Page == page) { app.Flow.Show(StorePage.Daily); yield return Page(StorePage.Daily); }
                    if (page == StorePage.Settings && app.Flow.Page != StorePage.Profile) { Click(app, "Profile"); yield return Page(StorePage.Profile); }
                    Click(app, control); yield return Page(page);
                    yield return Wait(() => !app.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page"), "The page did not settle");
                    AssertLastPieceClearsTheBar(shell, page + " at " + textScale);
                }
                app.Flow.SelectRealm(4); yield return Page(StorePage.Campaign);
                AssertLastPieceClearsTheBar(shell, "Closed realm at " + textScale);
            }
            shell.Frame = null;
        }
        private void AssertLastPieceClearsTheBar(PageShell shell, string page)
        {
            var scroll = shell.Scroll; scroll.verticalNormalizedPosition = 0; Canvas.ForceUpdateCanvases();
            var bar = shell.Chrome.GetComponentInChildren<SkinTabBar>();
            float floor = bar != null ? SkinUi.ScreenRect((RectTransform)bar.transform).yMax : shell.SafeArea.yMin;
            var viewport = SkinUi.ScreenRect(shell.Viewport);
            foreach (var piece in shell.Page.GetComponentsInChildren<Graphic>().Where(graphic => graphic.color.a > 0 && graphic.enabled &&
                !graphic.name.Contains("glow") && !graphic.name.Contains("halo") && graphic.name != "Realm map"))
            {
                var rect = SkinUi.ScreenRect(piece.rectTransform);
                if (rect.yMin >= viewport.yMax) continue;
                Assert.That(rect.yMin, Is.GreaterThanOrEqualTo(floor - .5f), page + ": " + piece.name + " stays under the tab bar");
            }
        }
        // Every Realms page, in each of its states, speaks the player's words (no
        // retired board or star-source names on screen) and keeps every pill's
        // label on one line on a compact phone at larger text.
        [UnityTest] public IEnumerator EveryRealmsPageSpeaksThePlayersWords()
        {
            // On a compact phone at larger text, where words are tightest.
            app.GetComponent<PageShell>().Frame = new Rect(0, 0, 360, 640);
            typeof(BoardController).GetProperty("TextScale").SetValue(board, 1.3f);
            app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile); app.Flow.Show(StorePage.Daily);
            IEnumerator Words(StorePage page, string state)
            {
                yield return Page(page);
                ZKube.Tests.Presentation.PageText.AssertPlayerWords(app, state);
                ZKube.Tests.Presentation.PageText.AssertPillLabelsOnOneLine(app, state);
            }
            yield return Words(StorePage.Daily, "Home");
            greeted = 0; app.Flow.Show(StorePage.Campaign); yield return Words(StorePage.Campaign, "Map with its greeting");
            app.Flow.Preview(1); yield return Words(StorePage.Level, "Level preview");
            app.Flow.SelectRealm(2); yield return Words(StorePage.Campaign, "Realm closed by stars");
            app.Flow.SelectRealm(4); yield return Words(StorePage.Campaign, "Realm closed by the purchase");
            app.Flow.Show(StorePage.Profile); yield return Words(StorePage.Profile, "Profile");
            Click(app, "Edit name"); yield return null; ZKube.Tests.Presentation.PageText.AssertPlayerWords(app, "Name editing");
            app.Flow.Show(StorePage.Settings); yield return Words(StorePage.Settings, "Settings");
            var goals = new CampaignGoals { Points = 60, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 };
            app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 168, StarSources = 7, EndReason = 1, Goals = goals });
            yield return Words(StorePage.Result, "Level won");
            app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 12, StarSources = 1, EndReason = 2, Goals = goals });
            yield return Words(StorePage.Result, "Level lost");
            app.Flow.Show(StorePage.Daily); yield return Page(StorePage.Daily);
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Words(StorePage.Result, "Daily result");
            app.Flow.Show(StorePage.Daily); yield return Words(StorePage.Daily, "Home after today's run");
        }
        private void AssertEveryVisiblePieceHasArt(string step)
        {
            foreach (var image in app.GetComponentsInChildren<Image>())
            {
                bool mask = image.GetComponent<Mask>() != null;
                if (!image.enabled || (!mask && image.color.a <= .001f)) continue;
                float alpha = 1;
                foreach (var group in image.GetComponentsInParent<CanvasGroup>()) { alpha *= group.alpha; if (group.ignoreParentGroups) break; }
                if (alpha <= .001f) continue;
                if (image.sprite != null)
                {
                    Assert.That(image.sprite.texture != null, Is.True, step + ": " + image.name + " shows a released texture");
                    continue;
                }
                var color = image.color;
                Assert.That(!mask && .2126f * color.r + .7152f * color.g + .0722f * color.b < .5f, Is.True,
                    step + ": " + image.name + " is drawn without its art");
            }
        }
        private Button[] Nodes() => app.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Trial ")).ToArray();
        // Each node shows its level number on one line, inside the node's touch
        // area, at both text sizes.
        private static void AssertNodeCaptions(Button[] nodes)
        {
            foreach (var node in nodes)
            {
                var caption = node.GetComponentInChildren<TMP_Text>(); caption.ForceMeshUpdate();
                Assert.That(caption.textInfo.lineCount, Is.EqualTo(1), node.name);
                var bounds = ((RectTransform)node.transform).rect;
                foreach (var character in caption.textInfo.characterInfo.Take(caption.textInfo.characterCount).Where(value => value.isVisible))
                    foreach (var corner in new[] { character.bottomLeft, character.topRight })
                    {
                        var local = node.transform.InverseTransformPoint(caption.transform.TransformPoint(corner));
                        Assert.That(bounds.Contains(local), Is.True, node.name + " caption exceeds its tile");
                    }
            }
        }
        [UnityTest] public IEnumerator RealmPagesAndEmblemDisposalPreserveTheInactiveBoardsAtlas()
        {
            app.Flow.Show(StorePage.Daily); yield return Page(StorePage.Daily);
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady();
            var retainedArt = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            yield return EndRun(); yield return Page(StorePage.Result);
            var leases = (System.Collections.IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var before = leases.Keys.Cast<string>().Where(key => key.Contains("/theme-")).ToHashSet();
            product.Write(state => { for (int realm = 1; realm <= 10; realm++) state.Stars[realm * 10 - 1] = 1; return state; });
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            var faces = app.GetComponentsInChildren<Image>().Where(value => value.name == "Guardian portrait").ToArray();
            Assert.That(faces.Length, Is.EqualTo(10)); Assert.That(faces.All(value => value.enabled && value.sprite != null), Is.True);
            Assert.That(faces.Select(value => value.sprite.texture).Distinct().Count(), Is.EqualTo(1), "All profile thumbnails share the one generated texture");
            Assert.That(faces[0].sprite.texture.width, Is.LessThanOrEqualTo(2048)); Assert.That(faces[0].sprite.texture.height, Is.LessThanOrEqualTo(2048));
            var added = leases.Keys.Cast<string>().Where(key => key.Contains("/theme-") && !before.Contains(key)).ToArray();
            Assert.That(added.All(key => key == "ZKube/Atlases/theme-1"), Is.True, "Only the worn profile background may acquire a new realm atlas");
            Assert.That(leases.Contains("ZKube/Atlases/portraits"), Is.True);
            var portraitOwner = (BoardArt)typeof(PageViews).GetField("portraits", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app.GetComponent<PageViews>());
            var portraitAtlas = (UnityEngine.Object)typeof(BoardArt).GetField("atlas", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(portraitOwner);
            var nativePointer = typeof(UnityEngine.Object).GetField("m_CachedPtr", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That((IntPtr)nativePointer.GetValue(portraitAtlas), Is.Not.EqualTo(IntPtr.Zero));
            Click(app, "Campaign"); yield return Page(StorePage.Campaign); Click(app, "Next"); yield return Page(StorePage.Campaign);
            Assert.That(leases.Contains("ZKube/Atlases/portraits"), Is.False);
            Assert.That((IntPtr)nativePointer.GetValue(portraitAtlas), Is.EqualTo(IntPtr.Zero));
            Assert.That(app.GetComponentsInChildren<Image>().Any(value => value.name == "Guardian portrait"), Is.False);
            Assert.That(app.Flow.Realm, Is.EqualTo(2)); Assert.That(retainedArt.Sprite("boss__celebrate"), Is.Not.Null);
            var common = (UnityEngine.U2D.SpriteAtlas)typeof(BoardArt).GetField("common", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(retainedArt);
            var uncached = common.GetSprite("mark");
            Assert.That(uncached, Is.Not.Null);
            UnityEngine.Object.Destroy(uncached);
        }
        [UnityTest] public IEnumerator NavigationDuringAssetLoadPublishesOnlyTheLatestPageAndDisposalStopsLateWork()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Next"); Assert.That(PageDrawn(), Is.False); yield return null;
            Assert.That((bool)typeof(StoreAppAdapter).GetField("loading", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app), Is.True);
            // Same public navigation command that page buttons dispatch, while
            // the old page's renderer is deliberately retired during loading.
            app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
            Assert.That(Nodes(), Is.Empty);
            app.Flow.SelectRealm(3); yield return null;
            UnityEngine.Object.Destroy(app.gameObject); yield return null; yield return null;
            Assert.That(app == null, Is.True); Assert.That(root.GetComponentsInChildren<StoreAppAdapter>().Length, Is.Zero);
            LogAssert.NoUnexpectedReceived();
        }
        [UnityTest] public IEnumerator AcceptedSaveFailureIsVisibleAcrossRecoveryAndResultExit()
        {
            app.Flow.Show(StorePage.Daily); yield return Page(StorePage.Daily);
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady(); failSave = true;
            Click(board.View, "Pause"); Click(board.View, "End run"); yield return null; Click(board.View, "End run");
            yield return Wait(() => board.RecoveryRequired && !board.Busy, "Expected recovery after accepted save failure");
            yield return Wait(() => WarningVisible, "Unsaved overlay was not shown over the board");
            Click(board.View, "Recover run"); yield return Wait(() => !board.RecoveryRequired && !board.Busy, "Accepted snapshot was not recovered");
            Assert.That(WarningVisible, Is.True); yield return Page(StorePage.Result);
            Assert.That(WarningVisible, Is.True); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
        }
        [UnityTest] public IEnumerator SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount()
        {
            yield return NamePlayer(); Click(app, "Settings"); yield return Page(StorePage.Settings);
            // The channel's row switches it; the kit slider sets its level.
            Click(app, "Music switch"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.EqualTo(AudioPolicy.ToggleOnLevel));
            Slide("Music slider", .73f);
            Assert.That(board.MusicVolume, Is.EqualTo(.73d)); Click(app, "Music switch"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.Zero); Click(app, "Music switch"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.EqualTo(.73d));
            Slide("Effects slider", .27f);
            Assert.That(board.EffectsVolume, Is.EqualTo(.27d)); Assert.That(board.MusicVolume, Is.EqualTo(.73d));
            Assert.That(audio[AudioPolicy.MusicKey], Is.EqualTo(.73f));
            Assert.That(audio[AudioPolicy.EffectsKey], Is.EqualTo(.27f)); Assert.That(board.Muted, Is.True);
            Slide("Music slider", 0);
            Click(app, "Back"); yield return Page(StorePage.Daily); Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Music switch"); yield return Page(StorePage.Settings); Assert.That(board.MusicVolume, Is.EqualTo(AudioPolicy.ToggleOnLevel));
        }
    }
}
