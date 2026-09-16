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
            public Task Connect() => Task.CompletedTask;
            public void FetchProduct() => ProductFetched?.Invoke("€4.99");
            public void FetchPurchases() => PurchasesFetched?.Invoke(Array.Empty<CampaignOrder>());
            public void Purchase() => Assert.Fail("This UI journey must never invoke a purchase");
            public void Confirm(CampaignOrder _) => Assert.Fail("This UI journey must never acknowledge a purchase");
            public void Dispose() { }
        }
        private GameObject root;
        private StoreAppController app;
        private BoardController board;
        private CampaignBilling billing;
        private LocalProductStore product;
        private StoreRunClient runs;
        private bool failSave;
        private readonly Dictionary<string, string> audio = new Dictionary<string, string>();

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Isolated store page journey");
            if (EventSystem.current == null)
                new GameObject("Shared test EventSystem", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var boardRoot = new GameObject("Store test board"); boardRoot.transform.SetParent(root.transform);
            board = boardRoot.AddComponent<BoardController>();
            // Avoid touching real preferences. The production private field is
            // the concrete AudioPreferences dependency; no new runtime seam.
            audio.Clear(); audio[AudioPolicy.StorageKey] = "{\"musicVolume\":0,\"effectsVolume\":0.4}";
            typeof(BoardController).GetField("audioPreferences", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(board,
                new AudioPreferences(key => audio.TryGetValue(key, out var value) ? value : null, (key, value) => audio[key] = value));
            typeof(BoardController).GetProperty("Muted").SetValue(board, true);
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, true);
            typeof(BoardController).GetProperty("Haptics").SetValue(board, false);
            typeof(BoardController).GetProperty("TextScale").SetValue(board, 1f);
            failSave = false;
            product = new LocalProductStore(_ => null, (_, __) => { if (failSave) throw new InvalidOperationException("Injected save failure"); });
            runs = new StoreRunClient(product, () => 20705L * 86400);
            billing = new CampaignBilling(new Driver(), () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppController>(); app.Initialize(product, runs, billing, board);
            yield return Page(StorePage.Name);
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            if (root != null) UnityEngine.Object.Destroy(root);
            yield return null; billing?.Dispose(); billing = null;
            LogAssert.NoUnexpectedReceived();
        }
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
        private IEnumerator Page(StorePage page) => Wait(() => app != null && app.Flow.Page == page && app.PageReady, "Page did not become ready: " + page);
        private IEnumerator BoardReady() => Wait(() => board != null && board.Ready && !board.Busy, "Board did not become ready: " + board?.ReadinessIssue);
        private IEnumerator NamePlayer()
        {
            var field = app.GetComponentInChildren<TMP_InputField>(); field.text = "  Page tester  ";
            Click(app, "Play"); yield return Page(StorePage.Daily);
        }
        private IEnumerator EndRun()
        {
            Click(board.View, "Pause"); Click(board.View, "End run");
            yield return null; Click(board.View, "End run");
            yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, "Run did not end");
        }
        private bool WarningVisible => app.GetComponentsInChildren<TMP_Text>().Any(text => text.gameObject.activeInHierarchy && text.text.StartsWith("Progress is not saved."));

        [UnityTest] public IEnumerator StandaloneNameGateDrawsVisiblePixelsWithoutInheritedSceneRendering()
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

        [UnityTest] public IEnumerator NameKeyboardHandlerRejectsBlankAndPlayButtonOpensLocalDaily()
        {
            var leases = (System.Collections.IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var common = leases["ZKube/Atlases/common"];
            var field = app.GetComponentInChildren<TMP_InputField>(); field.onSubmit.Invoke(" \t ");
            yield return Page(StorePage.Name); Assert.That(product.Read.Name, Is.Null);
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Enter a name"), Is.True);
            yield return NamePlayer(); Assert.That(product.Read.Name, Is.EqualTo("Page tester"));
            Assert.That(FindButton(app, "Play today").interactable, Is.True);
            Assert.That(leases["ZKube/Atlases/common"], Is.SameAs(common), "Navigation must retain shared art instead of reloading it");
        }
        [UnityTest] public IEnumerator PageButtonBindsLocalBoardAndTerminalContinueReturnsToResult()
        {
            yield return NamePlayer(); byte realm = runs.Today().Realm;
            Click(app, "Play today"); yield return BoardReady();
            Assert.That(board.Session.RealmId, Is.EqualTo(realm)); Assert.That(board.PresentedRealmId, Is.EqualTo(realm));
            Assert.That(product.Read.DailyAttempt.DayId, Is.EqualTo(runs.Today().DayId));
            yield return EndRun(); Click(board.View, "Continue"); yield return Page(StorePage.Result);
            Assert.That(board.gameObject.activeSelf, Is.False); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
            Click(app, "Done"); yield return Page(StorePage.Daily);
            Assert.That(FindButton(app, "View result").interactable, Is.True);
        }
        [UnityTest] public IEnumerator CampaignPageHasAuthoredNodesAndRealPreviewHandler()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            var graphic = app.GetComponentInChildren<CampaignPathGraphic>(); Assert.That(graphic, Is.Not.Null);
            var nodes = graphic.GetComponentsInChildren<Button>(); Assert.That(nodes.Length, Is.EqualTo(10));
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
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Text size: standard"); yield return Page(StorePage.Settings);
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            nodes = app.GetComponentInChildren<CampaignPathGraphic>().GetComponentsInChildren<Button>();
            AssertNodeCaptions(nodes);
            var first = nodes.Single(button => button.name.StartsWith("Trial 1 ·")); Assert.That(first.interactable, Is.True);
            Assert.That(nodes.Single(button => button.name.StartsWith("Trial 2 ·")).interactable, Is.False);
            first.onClick.Invoke(); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady(); Assert.That(board.Session.RealmId, Is.EqualTo(1));
        }
        private static void AssertNodeCaptions(Button[] nodes)
        {
            foreach (var node in nodes)
            {
                var caption = node.GetComponentInChildren<TMP_Text>(); caption.ForceMeshUpdate();
                Assert.That(caption.textInfo.lineCount, Is.EqualTo(2), node.name);
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
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady();
            var retainedArt = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            yield return EndRun(); Click(board.View, "Continue"); yield return Page(StorePage.Result);
            var leases = (System.Collections.IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var before = leases.Keys.Cast<string>().Where(key => key.Contains("/theme-")).ToHashSet();
            product.Write(state => { for (int realm = 1; realm <= 10; realm++) state.Stars[realm * 10 - 1] = 1; return state; });
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            var faces = app.GetComponentsInChildren<Image>().Where(value => value.name.StartsWith("Emblem ")).ToArray();
            Assert.That(faces.Length, Is.EqualTo(10)); Assert.That(faces.All(value => value.enabled && value.sprite != null), Is.True);
            Assert.That(faces.Select(value => value.sprite.texture).Distinct().Count(), Is.EqualTo(1), "All profile thumbnails share the one generated texture");
            Assert.That(faces[0].sprite.texture.width, Is.LessThanOrEqualTo(2048)); Assert.That(faces[0].sprite.texture.height, Is.LessThanOrEqualTo(2048));
            var added = leases.Keys.Cast<string>().Where(key => key.Contains("/theme-") && !before.Contains(key)).ToArray();
            Assert.That(added.All(key => key == "ZKube/Atlases/theme-1"), Is.True, "Only the worn profile background may acquire a new realm atlas");
            Assert.That(leases.Contains("ZKube/Atlases/portraits"), Is.True);
            var portraitOwner = (BoardArt)typeof(StoreAppController).GetField("portraitArt", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app);
            var portraitAtlas = (UnityEngine.Object)typeof(BoardArt).GetField("atlas", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(portraitOwner);
            var nativePointer = typeof(UnityEngine.Object).GetField("m_CachedPtr", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That((IntPtr)nativePointer.GetValue(portraitAtlas), Is.Not.EqualTo(IntPtr.Zero));
            Click(app, "Campaign"); yield return Page(StorePage.Campaign); Click(app, "Next"); yield return Page(StorePage.Campaign);
            Assert.That(leases.Contains("ZKube/Atlases/portraits"), Is.False);
            Assert.That((IntPtr)nativePointer.GetValue(portraitAtlas), Is.EqualTo(IntPtr.Zero));
            Assert.That(app.GetComponentsInChildren<Image>().Any(value => value.name.StartsWith("Emblem ")), Is.False);
            Assert.That(app.Flow.Realm, Is.EqualTo(2)); Assert.That(retainedArt.Sprite("boss__celebrate"), Is.Not.Null);
            var common = (UnityEngine.U2D.SpriteAtlas)typeof(BoardArt).GetField("common", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(retainedArt);
            var uncached = common.GetSprite("bonus__tiki");
            Assert.That(uncached, Is.Not.Null);
            UnityEngine.Object.Destroy(uncached);
        }
        [UnityTest] public IEnumerator NavigationDuringAssetLoadPublishesOnlyTheLatestPageAndDisposalStopsLateWork()
        {
            yield return NamePlayer(); Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Next"); Assert.That(app.PageReady, Is.False); yield return null;
            Assert.That((bool)typeof(StoreAppController).GetField("loading", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app), Is.True);
            // Same public navigation command that page buttons dispatch, while
            // the old page's renderer is deliberately retired during loading.
            app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
            Assert.That(app.GetComponentInChildren<CampaignPathGraphic>(), Is.Null);
            app.Flow.SelectRealm(3); yield return null;
            UnityEngine.Object.Destroy(app.gameObject); yield return null; yield return null;
            Assert.That(app == null, Is.True); Assert.That(root.GetComponentsInChildren<StoreAppController>().Length, Is.Zero);
            LogAssert.NoUnexpectedReceived();
        }
        [UnityTest] public IEnumerator AcceptedSaveFailureIsVisibleAcrossRecoveryAndResultExit()
        {
            yield return NamePlayer(); Click(app, "Play today"); yield return BoardReady(); failSave = true;
            Click(board.View, "Pause"); Click(board.View, "End run"); yield return null; Click(board.View, "End run");
            yield return Wait(() => board.RecoveryRequired && !board.Busy, "Expected recovery after accepted save failure");
            yield return Wait(() => WarningVisible, "Unsaved overlay was not shown over the board");
            Click(board.View, "Recover run"); yield return Wait(() => !board.RecoveryRequired && !board.Busy, "Accepted snapshot was not recovered");
            Assert.That(WarningVisible, Is.True); Click(board.View, "Continue"); yield return Page(StorePage.Result);
            Assert.That(WarningVisible, Is.True); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
        }
        [UnityTest] public IEnumerator SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount()
        {
            yield return NamePlayer(); Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Music: off"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.EqualTo(AudioPolicy.ToggleOnLevel));
            var slider = app.GetComponentsInChildren<Slider>().Single(value => value.name == "Music slider"); slider.value = 73;
            Assert.That(board.MusicVolume, Is.EqualTo(.73d)); Click(app, "Music: on"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.Zero); Click(app, "Music: off"); yield return Page(StorePage.Settings);
            Assert.That(board.MusicVolume, Is.EqualTo(.73d));
            var effects = app.GetComponentsInChildren<Slider>().Single(value => value.name == "Effects slider"); effects.value = 27;
            Assert.That(board.EffectsVolume, Is.EqualTo(.27d)); Assert.That(board.MusicVolume, Is.EqualTo(.73d));
            var persisted = JObject.Parse(audio[AudioPolicy.StorageKey]); Assert.That((double)persisted["musicVolume"], Is.EqualTo(.73d));
            Assert.That((double)persisted["effectsVolume"], Is.EqualTo(.27d)); Assert.That(board.Muted, Is.True);
            app.GetComponentsInChildren<Slider>().Single(value => value.name == "Music slider").value = 0;
            Click(app, "Profile"); yield return Page(StorePage.Profile); Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Music: off"); yield return Page(StorePage.Settings); Assert.That(board.MusicVolume, Is.EqualTo(AudioPolicy.ToggleOnLevel));
        }
    }
}
