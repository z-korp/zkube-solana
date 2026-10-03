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
        // The platform's player accounts, as a test sets them: signed out until Player is set.
        private sealed class Accounts : IPlayerAccounts
        {
            public PlayerAccount Player;
            public Exception Failure;
            public Task<PlayerAccount> SignIn() => Failure != null ? Task.FromException<PlayerAccount>(Failure) : Task.FromResult(Player);
            public bool Leaderboard = true;
            public readonly List<ulong> Submitted = new List<ulong>();
            public int Shown;
            public bool HasDailyLeaderboard => Leaderboard;
            public void SubmitDailyScore(ulong score) => Submitted.Add(score);
            public void ShowDailyLeaderboard() => Shown++;
        }
        private Accounts accounts;
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
            runs = new StoreRunClient(product, () => (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt);
            billing = new CampaignBilling(new Driver(), () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            accounts = new Accounts();
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board, accounts);
            // Every guardian has greeted unless a test asks for the first visit.
            greeted = ~0; Greet(app);
            yield return Page(StorePage.Home);
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
            string Path(Transform t) => t == null || t == parent.transform ? "" : Path(t.parent) + "/" + t.name;
            Assert.That(exactName.Length, Is.EqualTo(1), "Expected one active button: " + name + " (" + string.Join(", ", exactName.Select(value => Path(value.transform))) + ")");
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
        // A page is ready once it is drawn and the page before it has left: a
        // leaving page keeps its pieces for its fade, however fast frames run.
        private bool PageDrawn() => ((System.Collections.ICollection)typeof(PageShell).GetField("leaving", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app.GetComponent<PageShell>())).Count == 0 &&
            !(bool)typeof(StoreAppAdapter).GetField("dirty", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) &&
            !(bool)typeof(StoreAppAdapter).GetField("loading", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) &&
            app.GetComponentsInChildren<Image>().Where(image => image.name == "Guardian portrait").All(image => image.enabled && image.sprite != null);
        private IEnumerator Page(StorePage page) => Wait(() => app != null && app.Flow.Page == page && PageDrawn(), "Page did not become ready: " + page);
        private IEnumerator BoardReady() => Wait(() => board != null && ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy, "Board did not become ready: " + "Board is still busy or loading");
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

        // Realms names its player from the platform account (Google Play Games on
        // Android): signed in, the profile shows the account's name and avatar,
        // and a shared result carries the name; signed out, refused or failing,
        // it shows the emblem alone. There is no name to edit, and play never
        // waits for the sign-in.
        [UnityTest] public IEnumerator StoreShowsThePlayerAccountAndPlaysWithoutIt()
        {
            Assert.That(FindButton(app, "Play today").interactable, Is.True, "Play is open before any sign-in answers");
            Click(app, "Profile"); yield return Page(StorePage.Profile);
            Assert.That(app.ProfilePage().Name, Is.Null);
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Name text"), Is.False, "Signed out, the profile shows no name");
            Assert.That(app.GetComponentsInChildren<Image>().Count(image => image.name == "Worn emblem"), Is.EqualTo(1), "The emblem stands alone");
            Assert.That(app.GetComponentInChildren<TMP_InputField>(), Is.Null);
            Assert.That(Buttons().Any(button => button.name.EndsWith(" name")), Is.False, "There is no name to edit");
            Assert.That(app.ResultPage().PlayerName, Is.Null);
            // The platform signs the player in.
            var avatar = new Texture2D(8, 8);
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef", Avatar = avatar };
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Profile);
            Assert.That(app.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Name text").text, Is.EqualTo("Mira of the Reef"));
            Assert.That(app.GetComponentsInChildren<RawImage>().Single(image => image.name == "Player avatar picture").texture, Is.SameAs(avatar));
            Assert.That(app.GetComponentInChildren<TMP_InputField>(), Is.Null, "Nor a name to edit once signed in");
            Assert.That(app.ResultPage().PlayerName, Is.EqualTo("Mira of the Reef"));
            Assert.That(LocalProductCodec.Encode(product.Read), Does.Not.Contain("name"), "The save keeps no name");
            // A sign-in that fails leaves no account and the game playable.
            accounts.Player = null; accounts.Failure = new InvalidOperationException("Play Games is unavailable");
            signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The failed sign-in did not answer"); yield return Page(StorePage.Profile);
            Assert.That(app.Flow.Account, Is.Null); Assert.That(app.Flow.Error, Is.Null);
            Click(app, "Home"); yield return Page(StorePage.Home);
            Assert.That(FindButton(app, "Play today").interactable, Is.True);
            UnityEngine.Object.Destroy(avatar);
        }
        // Signed in, each finished Daily's score goes to the platform's Daily
        // leaderboard, and a Leaderboard button on the Daily card and the Daily
        // result opens the platform's own screen. Signed out there is no button
        // and no submission, and the Daily plays the same.
        [UnityTest] public IEnumerator AFinishedDailyGoesToThePlatformLeaderboardOnlyWhenSignedIn()
        {
            Assert.That(Buttons().Any(button => button.name == "Leaderboard"), Is.False, "Signed out, Home has no Leaderboard button");
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef" };
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Home);
            Click(app, "Leaderboard"); Assert.That(accounts.Shown, Is.EqualTo(1), "The Daily card opens the platform's leaderboard");
            Click(app, "Play today"); yield return BoardReady();
            Assert.That(accounts.Submitted, Is.Empty, "Nothing is submitted while the run plays");
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(product.Read.DailyAttempt.Finished, Is.True);
            Assert.That(accounts.Submitted, Is.EqualTo(new[] { product.Read.DailyAttempt.DailyScore }), "The finished Daily's score is submitted once");
            Click(app, "Leaderboard"); Assert.That(accounts.Shown, Is.EqualTo(2), "The Daily result opens it too");
            Click(app, "Continue"); yield return Page(StorePage.Home);
            Click(app, "View result"); yield return Page(StorePage.Result);
            Assert.That(accounts.Submitted.Count, Is.EqualTo(1), "Viewing the result again submits nothing");
        }
        [UnityTest] public IEnumerator ASignedOutDailySubmitsNothingAndShowsNoLeaderboard()
        {
            Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(product.Read.DailyAttempt.Finished, Is.True, "The Daily plays the same signed out");
            Assert.That(accounts.Submitted, Is.Empty);
            Assert.That(Buttons().Any(button => button.name == "Leaderboard"), Is.False, "No Leaderboard button on the result");
            Click(app, "Continue"); yield return Page(StorePage.Home);
            Assert.That(Buttons().Any(button => button.name == "Leaderboard"), Is.False);
            // A platform without a leaderboard configured shows none either, signed in.
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef" }; accounts.Leaderboard = false;
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Home);
            Assert.That(Buttons().Any(button => button.name == "Leaderboard"), Is.False);
        }
        // A finished run holds on the board for a moment, then its result page opens.
        [UnityTest] public IEnumerator PageButtonBindsLocalBoardAndTerminalOpensTheResultPage()
        {
            byte realm = runs.Today().Realm;
            Click(app, "Play today"); yield return BoardReady();
            Assert.That(board.Session.RealmId, Is.EqualTo(realm)); Assert.That(ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId, Is.EqualTo(realm));
            Assert.That(product.Read.DailyAttempt.DayId, Is.EqualTo(runs.Today().DayId));
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(board.gameObject.activeSelf, Is.False); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
            Assert.That(app.Flow.LastCampaign, Is.Null);
            // The result has no tab bar; Continue returns to Home.
            Click(app, "Continue"); yield return Page(StorePage.Home);
            // A used Daily gives its reason where Play was, never a greyed-out
            // Play, and counts to the next Daily; the result, which holds the
            // run's numbers, is the action left to take, so it is the primary.
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Play today")), Is.False);
            // The test clock sits on the day's first second: the next Daily is a whole day away.
            Assert.That(Texts(), Does.Contain("Today’s attempt is used").And.Contain("Next Daily in 23:59:59"));
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
            yield return Page(StorePage.Home);
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
            Assert.That(Texts(), Does.Contain("Wearing Mako’s emblem").And.Contain("Mako · worn"));
        }
        private Button[] Buttons() => app.GetComponentsInChildren<Button>().Where(value => value.gameObject.activeInHierarchy).ToArray();
        private string[] Texts() => app.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy).Select(text => text.text).ToArray();
        [UnityTest] public IEnumerator CampaignPageHasAuthoredNodesAndRealPreviewHandler()
        {
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
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
            // The Campaign header holds the realm arrows; settings is the fourth tab.
            Click(app, "Home"); yield return Page(StorePage.Home);
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Text size: standard"); yield return Page(StorePage.Settings);
            Assert.That(Buttons().Any(button => button.name == "Back"), Is.False, "A tab page has no back button");
            Click(app, "Home"); yield return Page(StorePage.Home);
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
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            // The preview words every goal from its constraint and shows its target
            // (there is no progress yet) under the guardian's line for the level, in
            // its bubble; the rule's words sit with its pictograms. No internal source names.
            var level = Protocol.Realms[0].Levels[0]; var catalog = PageCatalog.Load(); var rule = catalog.Rule(1);
            var texts = Texts();
            Assert.That(texts, Does.Contain("Score").And.Contain(Protocol.CampaignTargets[0].ToString("N0", System.Globalization.CultureInfo.InvariantCulture)));
            Assert.That(texts, Does.Contain(catalog.ObjectiveName(level.Primary[0], level.Primary[1], level.Primary[2])).And.Contain(level.Primary[2].ToString()));
            Assert.That(texts, Does.Contain(catalog.ObjectiveName(level.Secondary[0], level.Secondary[1], level.Secondary[2])));
            Assert.That(texts, Does.Contain(catalog.Realm(1).guardianLines.greeting).And.Contain("Tiki · " + catalog.Realm(1).guardianName)
                .And.Contain("Level 1").And.Contain(rule.description).And.Contain("Earns a Wave"));
            Assert.That(texts, Does.Not.Contain(rule.description + "\n" + rule.effect));
            Assert.That(texts.Any(text => text.StartsWith("0 / ")), Is.False);
            Assert.That(texts.Where(text => text != null).Any(text => new[] { "Theme", "Shape", "Blow", "★", "☆" }.Any(text.Contains)), Is.False);
            Click(app, "Play"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            var outcome = app.Flow.LastCampaign;
            Assert.That(outcome, Is.Not.Null); Assert.That(outcome.Realm, Is.EqualTo(1)); Assert.That(outcome.Level, Is.EqualTo(1));
            Assert.That(outcome.EndReason, Is.EqualTo(3));
            // The guardian says how it went; an ended run lights no star.
            Assert.That(Texts(), Does.Contain("Run ended").And.Contain("An ended run keeps no stars.")
                .And.Contain(catalog.Realm(1).guardianLines.incomplete));
            var sockets = app.GetComponentsInChildren<Image>().Where(image => image.name.StartsWith("Result star ") && image.name != "Result star flight").ToArray();
            Assert.That(sockets.Length, Is.EqualTo(3));
            Assert.That(sockets.All(image => image.sprite.name.StartsWith(SkinSlots.StarSocket)), Is.True);
            Assert.That(Buttons().Any(button => button.name == "Share"), Is.False, "A Campaign result has no Share");
            Click(app, "Retry"); yield return BoardReady();
            Assert.That(board.Session.RealmId, Is.EqualTo(1)); Assert.That(runs.Active("campaign").Level, Is.EqualTo(1));
            yield return EndRun(); yield return Page(StorePage.Result);
            Click(app, "Map"); yield return Page(StorePage.Campaign);
        }
        // The home Campaign card follows the furthest realm the core progression
        // opens and plays the level the map would: its first open level without
        // a star, opening that level's preview.
        [UnityTest] public IEnumerator HomeCampaignCardPlaysTheFurthestOpenRealmsCurrentLevel()
        {
            product.Write(state => { state.Stars[9] = 1; state.Stars[19] = 2; return state; });
            var summary = app.CampaignSummary();
            Assert.That(summary.Realm, Is.EqualTo(3)); Assert.That(summary.Stars, Is.Zero);
            app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Assert.That(Texts(), Does.Contain("Realm 3 of 10"));
            // The lockup wears the colours of the day's Daily realm.
            var art = app.GetComponent<PageShell>().Artwork;
            Assert.That(art.RealmId, Is.EqualTo(app.DailyPage().Realm));
            Assert.That(app.GetComponentsInChildren<Image>().Single(image => image.name == "Wordmark").sprite, Is.EqualTo(art.SkinRealm("wordmark-realms")));
            Click(app, "Play level 21"); yield return Page(StorePage.Level);
            Assert.That(app.Flow.Realm, Is.EqualTo(3)); Assert.That(app.Flow.Level, Is.EqualTo(1));
        }
        // The Campaign card's place line sits on one line at every phone size, at
        // its longest: the last realm, with the last level on the button under it.
        [UnityTest] public IEnumerator HomeCampaignCardLineStaysOnOneLineAtItsLongestOnEveryPhone()
        {
            product.Write(state => { for (int i = 0; i < state.Stars.Length - 1; i++) state.Stars[i] = 3; state.CampaignOwned = true; return state; });
            var shell = app.GetComponent<PageShell>();
            foreach (var (phone, name) in new (System.Action<PageShell>, string)[] {
                (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640"), (value => ZKube.Tests.Presentation.Phones.EmulatorDefault(value), "emulator default"),
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker") })
            {
                phone(shell);
                try
                {
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                    Assert.That(FindButton(app, "Play level 100"), Is.Not.Null, name);
                    foreach (string piece in new[] { "Campaign line", "Campaign guardian name" })
                    {
                        var text = app.GetComponentsInChildren<TMP_Text>().Single(value => value.name == piece);
                        if (piece == "Campaign line") Assert.That(text.text, Is.EqualTo("Realm 10 of 10"));
                        text.ForceMeshUpdate();
                        Assert.That(text.textInfo.lineCount, Is.EqualTo(1), name + ": " + piece + " wraps \"" + text.text + "\"");
                        Assert.That(text.preferredWidth, Is.LessThanOrEqualTo(text.rectTransform.rect.width + 1), name + ": " + piece + " overflows");
                    }
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
        }
        // The longest realm name sits on one line wherever a Campaign page draws
        // it: Home's card, the map's header, the level preview and the pause sheet.
        [UnityTest] public IEnumerator TheLongestRealmNameStaysOnOneLineOnEveryCampaignPageAndPhone()
        {
            var catalog = PageCatalog.Load();
            byte realm = (byte)Enumerable.Range(1, Protocol.Realms.Length).OrderByDescending(id => catalog.Realm((byte)id).realmName.Length).First();
            string name = catalog.Realm(realm).realmName;
            int levels = Protocol.CampaignTargets.Length;
            product.Write(state => { for (int i = 0; i < (realm - 1) * levels; i++) state.Stars[i] = 3; state.CampaignOwned = true; return state; });
            Assert.That(app.Flow.FurthestRealm, Is.EqualTo(realm));
            var shell = app.GetComponent<PageShell>();
            void OneLine(string at, Component page = null)
            {
                var drawn = ZKube.Tests.Presentation.PageText.Visible(page ?? app).Where(text => text.text.Contains(name)).ToArray();
                Assert.That(drawn, Is.Not.Empty, at + " draws " + name);
                foreach (var text in drawn)
                {
                    text.ForceMeshUpdate();
                    Assert.That(text.textInfo.lineCount, Is.EqualTo(1), at + ": " + text.name + " wraps \"" + text.text + "\"");
                    Assert.That(text.preferredWidth, Is.LessThanOrEqualTo(text.rectTransform.rect.width + 1), at + ": " + text.name + " overflows \"" + text.text + "\"");
                }
            }
            foreach (var (phone, size) in new (System.Action<PageShell>, string)[] {
                (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640"), (value => ZKube.Tests.Presentation.Phones.EmulatorDefault(value), "emulator default"),
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker") })
            {
                phone(shell);
                try
                {
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home); OneLine(size + " Home");
                    app.Flow.SelectRealm(realm); yield return Page(StorePage.Campaign); OneLine(size + " map");
                    app.Flow.Preview(realm, 1); yield return Page(StorePage.Level); OneLine(size + " preview");
                    app.Flow.PlayCampaign(); yield return BoardReady();
                    Click(board.View, "Pause"); yield return null; OneLine(size + " pause", board.View);
                    Click(board.View, "End run"); yield return null; Click(board.View, "End run");
                    yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, "Run did not end");
                    yield return Page(StorePage.Result);
                    app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
        }
        // At the larger text size on a 360 x 640 phone (its safe area as the
        // device reports it), Home is taller than the space between the
        // wordmark's top and the tab bar; it scrolls, and every panel and action
        // comes fully into view above the tab bar.
        [UnityTest] public IEnumerator LargeTextHomeScrollsFullyIntoViewOnACompactPhone()
        {
            var shell = app.GetComponent<PageShell>();
            ZKube.Tests.Presentation.Phones.Compact(shell);
            try
            {
                typeof(BoardController).GetProperty("TextScale").SetValue(board, 1.3f);
                Click(app, "Profile"); yield return Page(StorePage.Profile);
                Click(app, "Home"); yield return Page(StorePage.Home);
                var viewport = SkinUi.ScreenRect(shell.Viewport);
                var tabs = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
                Assert.That(viewport.yMin, Is.GreaterThanOrEqualTo(tabs.yMax - .5f));
                Assert.That(viewport.yMax, Is.LessThanOrEqualTo(640.5f));
                // Below the emulator's default phone a page may scroll; every piece still comes fully into view.
                Rect Of(Component value) => SkinUi.ScreenRect((RectTransform)value.transform);
                void Inside(Component value)
                {
                    var rect = Of(value);
                    Assert.That(rect.yMin, Is.GreaterThanOrEqualTo(viewport.yMin - .5f), value.name + " stays under the tab bar");
                    Assert.That(rect.yMax, Is.LessThanOrEqualTo(viewport.yMax + .5f), value.name + " runs above the page");
                    Assert.That(rect.xMin, Is.GreaterThanOrEqualTo(-.5f), value.name); Assert.That(rect.xMax, Is.LessThanOrEqualTo(360.5f), value.name);
                }
                // Each piece scrolls fully into view: the page is scrolled until the
                // piece's bottom clears the tab bar, then the piece lies inside.
                IEnumerator Reveal(Component value)
                {
                    var rect = Of(value);
                    if (rect.yMin < viewport.yMin) shell.Offset += viewport.yMin - rect.yMin;
                    else if (rect.yMax > viewport.yMax) shell.Offset -= rect.yMax - viewport.yMax;
                    Canvas.ForceUpdateCanvases(); yield return null;
                    Inside(value);
                }
                var images = app.GetComponentsInChildren<Image>();
                Inside(images.Single(image => image.name == "Wordmark"));
                yield return Reveal(images.Single(image => image.name == "Daily card"));
                yield return Reveal(FindButton(app, "Play today"));
                shell.Scroll.verticalNormalizedPosition = 0; Canvas.ForceUpdateCanvases(); yield return null;
                Inside(images.Single(image => image.name == "Campaign card"));
                Inside(FindButton(app, "Play level 1"));
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
        }
        // The first visit to a realm's map greets once: the guardian's line, then
        // its rule and what the bonus does. A tap continues, and it does not return.
        [UnityTest] public IEnumerator FirstVisitToARealmGreetsOnceWithTheLineAndTheRule()
        {
            greeted = 0; 
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            var catalog = PageCatalog.Load(); var rule = catalog.Rule(1);
            var talk = app.GetComponentInChildren<GuardianTalk>(); talk.Complete();
            Assert.That(Texts(), Does.Contain(catalog.Realm(1).guardianLines.greeting).And.Contain(catalog.Realm(1).guardianName)
                .And.Contain(catalog.Realm(1).guardianTitle));
            // A tap turns to the rule page: what the rule earns, the rule and its effect.
            Click(app, "Continue"); yield return null;
            Assert.That(Texts(), Does.Not.Contain(catalog.Realm(1).guardianLines.greeting));
            Assert.That(Texts(), Does.Contain("Earn a " + HudLayout.BonusName(rule.bonus)).And.Contain(rule.description.TrimEnd('.') + ".").And.Contain(rule.effect));
            Assert.That(new GuardianGreetings(() => greeted, _ => { }).Greeted(1), Is.False, "The rule page is part of the greeting");
            Click(app, "Continue"); yield return null;
            Assert.That(Texts(), Does.Not.Contain(rule.effect));
            Assert.That(new GuardianGreetings(() => greeted, _ => { }).Greeted(1), Is.True);
            Click(app, "Home"); yield return Page(StorePage.Home);
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Assert.That(Texts(), Does.Not.Contain(catalog.Realm(1).guardianLines.greeting));
        }
        // The map repeats the current level's action as its primary; realm 1 has no
        // realm before it, so its back arrow is not drawn.
        [UnityTest] public IEnumerator MapPrimaryPlaysTheCurrentLevelAndUnavailableArrowsAreNotDrawn()
        {
            product.Write(state => { state.Stars[0] = 3; state.Stars[1] = 2; return state; });
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Assert.That(Buttons().Any(button => button.name == "Previous"), Is.False);
            Assert.That(FindButton(app, "Next").interactable, Is.True);
            Click(app, "Play level 3"); yield return Page(StorePage.Level);
            Assert.That(app.Flow.Level, Is.EqualTo(3));
            Assert.That(Texts(), Does.Contain("Level 3"));
        }
        // The map fits its whole path between the header and Play on both
        // phones, spread over the room's width and height apart: it never
        // scrolls, so another realm always opens whole, and the path spans at
        // least 70% of the width. Every
        // node is at least 34 dp, and every node and its star row clear the
        // others by at least 4 dp in every realm, with every level finished and
        // with a current node, as the spec's footprint rule asks.
        [UnityTest] public IEnumerator EveryRealmsMapFitsWholeAndItsNodesClearEachOtherOnBothPhones()
        {
            var shell = app.GetComponent<PageShell>();
            try
            {
                foreach (bool compact in new[] { false, true })
                {
                    if (compact) ZKube.Tests.Presentation.Phones.Compact(shell); else ZKube.Tests.Presentation.Phones.Seeker(shell);
                    float d = shell.SafeArea.height / (compact ? 572 : 882);
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    string at = compact ? "360 x 640 map" : "Seeker map";
                    ScreenFits(shell, at, "Play level 1");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, at);
                    foreach (int finished in new[] { 10, 4 })
                    {
                        product.Write(state => {
                            state.CampaignOwned = true;
                            // Each guardian keeps its star, so every realm is open.
                            for (int index = 0; index < state.Stars.Length; index++) state.Stars[index] = (byte)(index % 10 < finished || index % 10 == 9 ? 3 : 0);
                            return state;
                        });
                        for (byte realm = 1; realm <= 10; realm++)
                        {
                            app.Flow.SelectRealm(realm); yield return Page(StorePage.Campaign);
                            yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                            string where = at + " of realm " + realm + " with " + finished + " finished";
                            Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), where + " does not scroll");
                            var nodes = Nodes();
                            Assert.That(nodes.Length, Is.EqualTo(10), where);
                            var faces = nodes.Select(node => SkinUi.ScreenRect(node.GetComponentsInChildren<Image>()
                                .Single(image => image.name == node.name + " node" || image.name == node.name + " ring").rectTransform)).ToArray();
                            foreach (var face in faces) Assert.That(face.width / d, Is.GreaterThanOrEqualTo(PageViews.MinimumNodeDp - .01f), where + ": a node is at least 34 dp");
                            Assert.That((faces.Max(face => face.xMax) - faces.Min(face => face.xMin)) / shell.SafeArea.width, Is.GreaterThanOrEqualTo(.7f),
                                where + ": the path spans the width");
                            var feet = nodes.Select(node => node.GetComponentsInChildren<Image>()
                                .Where(image => image.name == node.name + " node" || image.name == node.name + " ring" || image.name.StartsWith(node.name + " star "))
                                .Select(image => SkinUi.ScreenRect(image.rectTransform))
                                .Aggregate((a, b) => Rect.MinMaxRect(Mathf.Min(a.xMin, b.xMin), Mathf.Min(a.yMin, b.yMin), Mathf.Max(a.xMax, b.xMax), Mathf.Max(a.yMax, b.yMax))))
                                .ToArray();
                            for (int a = 0; a < feet.Length; a++)
                                for (int b = a + 1; b < feet.Length; b++)
                                {
                                    float clear = Mathf.Max(Mathf.Max(feet[b].xMin - feet[a].xMax, feet[a].xMin - feet[b].xMax),
                                        Mathf.Max(feet[b].yMin - feet[a].yMax, feet[a].yMin - feet[b].yMax));
                                    Assert.That(clear / d, Is.GreaterThanOrEqualTo(4 - .01f), where + ": nodes " + (a + 1) + " and " + (b + 1) + " clear by " + clear / d + " dp");
                                }
                            var header = SkinUi.ScreenRect(app.GetComponentsInChildren<Image>().Single(image => image.name == "Map header").rectTransform);
                            var play = SkinUi.ScreenRect((RectTransform)FindButton(app, "Play level").transform);
                            foreach (var foot in feet)
                                Assert.That(foot.yMax <= header.yMin + .5f && foot.yMin >= play.yMax - .5f, Is.True, where + ": every node sits between the header and Play");
                        }
                        product.Write(state => { state.CampaignOwned = false; for (int index = 0; index < state.Stars.Length; index++) state.Stars[index] = 0; return state; });
                    }
                    app.Flow.SelectRealm(1); yield return Page(StorePage.Campaign);
                }
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
        }
        // A realm the progression has not opened says why and leads back; a realm
        // behind the store's purchase offers it and restore, and says so when the
        // store cannot be reached, with a retry in its place.
        [UnityTest] public IEnumerator LockedRealmsSayWhyAndOfferTheWayForward()
        {
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
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
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady();
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            yield return EndRun(); yield return Page(StorePage.Result);
            var retry = FindButton(app, "Retry");
            Assert.That(retry.IsInteractable(), Is.False, "Actions arrive last");
            FindButton(app, "Skip").onClick.Invoke(); yield return null;
            Assert.That(retry.IsInteractable(), Is.True);
            Assert.That(Buttons().Any(button => button.name == "Skip"), Is.False);
            Assert.That(Texts().Any(text => text != null && text.StartsWith(app.Flow.LastCampaign.Score.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + "<")),
                "The score row reads the run's final score");
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, true);
            Click(app, "Retry"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(FindButton(app, "Retry").IsInteractable(), Is.True);
            Assert.That(Buttons().Any(button => button.name == "Skip"), Is.False);
        }
        // DECISIONS 2026-10-02: on a result the kept stars fill in place in their
        // sockets, left to right, each with a pop; none is brought in from
        // elsewhere. Whichever goals earned them, the first sockets fill. Reduced
        // motion shows them filled at once.
        [UnityTest] public IEnumerator ResultStarsFillInPlaceLeftToRightAndPop()
        {
            var level = Protocol.Realms[0].Levels[0];
            var goals = new CampaignGoals { Points = Protocol.CampaignTargets[0], PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1],
                PrimaryCount = level.Primary[2], SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] };
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady();
            Image[] Crown() => Enumerable.Range(1, 3).Select(i => app.GetComponentsInChildren<Image>().Last(image => image.name == "Result star " + i)).ToArray();
            bool Lit(Image socket) => socket.sprite.name.StartsWith(SkinSlots.StarLit);
            foreach (byte sources in new byte[] { 4, 6, 5, 7 })
            {
                int kept = HudLayout.StarCount(sources); string at = "sources " + sources;
                typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
                app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 8, StarSources = sources, EndReason = (byte)(kept == 3 ? 1 : 2), PrimaryProgress = 4, Goals = goals });
                yield return Page(StorePage.Result);
                var crown = Crown(); var places = crown.Select(socket => socket.rectTransform.anchoredPosition).ToArray();
                Assert.That(crown.Any(Lit), Is.False, at + ": the sockets start empty");
                float peak = 1;
                for (float end = Time.realtimeSinceStartup + 3; Time.realtimeSinceStartup < end && app.GetComponentsInChildren<PageSequence>().Any(sequence => sequence.Playing);)
                {
                    Assert.That(app.GetComponentsInChildren<Image>().Any(image => image.name.Contains("flight")), Is.False, at + ": no star flies in");
                    // Left to right: a socket lights only after the one before it.
                    for (int i = 1; i < 3; i++) Assert.That(Lit(crown[i]) && !Lit(crown[i - 1]), Is.False, at + ": socket " + (i + 1) + " waits for socket " + i);
                    peak = Mathf.Max(peak, crown[0].rectTransform.localScale.x);
                    yield return null;
                }
                Assert.That(peak, Is.GreaterThan(1.05f), at + ": a filling star pops");
                for (int i = 0; i < 3; i++)
                {
                    Assert.That(Lit(crown[i]), Is.EqualTo(i < kept), at + ": socket " + (i + 1));
                    Assert.That(crown[i].rectTransform.localScale, Is.EqualTo(Vector3.one), at);
                    Assert.That(Vector2.Distance(places[i], crown[i].rectTransform.anchoredPosition), Is.LessThan(.5f), at + ": the star stays in its socket");
                }
                typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, true);
                app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 8, StarSources = sources, EndReason = (byte)(kept == 3 ? 1 : 2), PrimaryProgress = 4, Goals = goals });
                yield return Page(StorePage.Result); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                crown = Crown();
                for (int i = 0; i < 3; i++) Assert.That(Lit(crown[i]), Is.EqualTo(i < kept), at + ": reduced motion shows socket " + (i + 1) + " at once");
                Assert.That(app.GetComponentsInChildren<PageSequence>().Any(sequence => sequence.Playing), Is.False);
            }
        }
        // The Daily result: the guardian's line, the score, the day's objective
        // count and the streak, with sharing as the primary.
        [UnityTest] public IEnumerator DailyResultShowsTheScoreObjectiveAndStreakWithSharing()
        {
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            var today = runs.Today(); var catalog = PageCatalog.Load();
            var texts = Texts();
            // Realms speaks of the run: a new best, a scoring run, or one that scored nothing; never the Arena's greeting.
            var lines = catalog.Realm(today.Realm).guardianLines; var attempt = product.Read.DailyAttempt;
            string said = attempt.DailyScore > 0 && attempt.DailyScore >= product.Read.BestDailyScore ? lines.newBestLine : lines.Stars(attempt.DailyScore > 0 ? 2 : 1);
            Assert.That(texts, Does.Contain("Daily complete").And.Contain(said).And.Contain("Daily streak").And.Contain("Multiplier reached")
                .And.Contain(attempt.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)));
            Assert.That(texts, Does.Not.Contain(lines.dailyGreeting));
            if (today.ObjectiveKind != 0) Assert.That(texts, Does.Contain(catalog.ObjectiveName(today.ObjectiveKind, today.ObjectiveValue)));
            // Continue leads; Share sits beside it.
            Assert.That(FindButton(app, "Continue").GetComponent<Image>().sprite.name, Does.StartWith(SkinSlots.ButtonPrimary));
            Assert.That(FindButton(app, "Share").GetComponent<Image>().sprite.name, Does.StartWith(SkinSlots.ButtonSecondary));
            Assert.That(texts.Any(text => text != null && text.StartsWith("Today’s attempt is used. Next Daily in ")), Is.True);
            var shell = app.GetComponent<PageShell>();
            foreach (var (phone, name) in new (System.Action<PageShell>, string)[] {
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker"), (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640") })
            {
                phone(shell);
                try
                {
                    app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                    Click(app, "View result"); yield return Page(StorePage.Result);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, name + " daily result");
                    ScreenFits(shell, name + " daily result", "Continue", "Share");
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
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
                ("Profile", StorePage.Profile), ("Settings", StorePage.Settings), ("Profile", StorePage.Profile), ("Home", StorePage.Home),
                ("Campaign", StorePage.Campaign), ("Profile", StorePage.Profile), ("Home", StorePage.Home) };
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
        [UnityTest] public IEnumerator EveryPagesLastPieceScrollsAboveTheTabBarOnACompactPhone()
        {
            var shell = app.GetComponent<PageShell>();
            ZKube.Tests.Presentation.Phones.Compact(shell);
            product.Write(state => { state.Stars[0] = 3; state.Stars[9] = 1; return state; });
            foreach (var textScale in new[] { 1f, 1.3f })
            {
                typeof(BoardController).GetProperty("TextScale").SetValue(board, textScale);
                foreach (var (control, page) in new[] { ("Home", StorePage.Home), ("Campaign", StorePage.Campaign), ("Profile", StorePage.Profile),
                    ("Settings", StorePage.Settings) })
                {
                    if (app.Flow.Page == page) { app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home); }
                    Click(app, control); yield return Page(page);
                    yield return Wait(() => !app.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page"), "The page did not settle");
                    AssertLastPieceClearsTheBar(shell, page + " at " + textScale);
                }
                app.Flow.SelectRealm(4); yield return Page(StorePage.Campaign);
                AssertLastPieceClearsTheBar(shell, "Closed realm at " + textScale);
            }
            ZKube.Tests.Presentation.Phones.Clear(shell);
        }
        private void AssertLastPieceClearsTheBar(PageShell shell, string page)
        {
            var scroll = shell.Scroll; scroll.verticalNormalizedPosition = 0; Canvas.ForceUpdateCanvases();
            // Past the tab bar (or the screen's bottom), and its 24 dp fade on a page that scrolls, fully in view.
            var bar = shell.Chrome.GetComponentInChildren<SkinTabBar>();
            bool scrolls = scroll.content.rect.height > scroll.viewport.rect.height + .5f;
            float floor = (bar != null ? SkinUi.ScreenRect((RectTransform)bar.transform).yMax : shell.SafeArea.yMin) + (scrolls ? PageViews.FadeDp : 0);
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
            ZKube.Tests.Presentation.Phones.Compact(app.GetComponent<PageShell>());
            typeof(BoardController).GetProperty("TextScale").SetValue(board, 1.3f);
            app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile); app.Flow.Show(StorePage.Home);
            IEnumerator Words(StorePage page, string state)
            {
                yield return Page(page);
                ZKube.Tests.Presentation.PageText.AssertPlayerWords(app, state);
                ZKube.Tests.Presentation.PageText.AssertPillLabelsOnOneLine(app, state);
            }
            yield return Words(StorePage.Home, "Home");
            greeted = 0; app.Flow.Show(StorePage.Campaign); yield return Words(StorePage.Campaign, "Map with its greeting");
            app.Flow.Preview(1); yield return Words(StorePage.Level, "Level preview");
            app.Flow.SelectRealm(2); yield return Words(StorePage.Campaign, "Realm closed by stars");
            app.Flow.SelectRealm(4); yield return Words(StorePage.Campaign, "Realm closed by the purchase");
            app.Flow.Show(StorePage.Profile); yield return Words(StorePage.Profile, "Profile");
            app.Flow.Show(StorePage.Settings); yield return Words(StorePage.Settings, "Settings");
            var goals = new CampaignGoals { Points = 60, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 };
            app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 168, StarSources = 7, EndReason = 1, Goals = goals });
            yield return Words(StorePage.Result, "Level won");
            app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 12, StarSources = 1, EndReason = 2, Goals = goals });
            yield return Words(StorePage.Result, "Level lost");
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Words(StorePage.Result, "Daily result");
            app.Flow.Show(StorePage.Home); yield return Words(StorePage.Home, "Home after today's run");
        }
        // View result on the used Daily opens today's Daily result, even right
        // after a Campaign run's result page.
        [UnityTest] public IEnumerator ViewResultOpensTodaysDailyResultAfterACampaignResult()
        {
            Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(app.ResultPage().Mode, Is.EqualTo("Daily"));
            app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
            app.Flow.Preview(1); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(app.ResultPage().Mode, Is.EqualTo("Campaign"), "A finished Campaign run opens its own result");
            Click(app, "Map"); yield return Page(StorePage.Campaign);
            Click(app, "Home"); yield return Page(StorePage.Home);
            Click(app, "View result"); yield return Page(StorePage.Result);
            var result = app.ResultPage();
            Assert.That(result.Mode, Is.EqualTo("Daily"));
            Assert.That(result.Day, Is.EqualTo(runs.Today().DayId));
            Assert.That(Texts(), Does.Contain("Daily complete"));
        }
        // On a compact phone the level preview and every Campaign result keep
        // their actions on screen without scrolling; the result says what the
        // core keeps for its end reason, and leaves "try again" to the guardian.
        [UnityTest] public IEnumerator PreviewAndResultsKeepTheirActionsOnACompactPhone()
        {
            // The compact phone and the Seeker, each with the safe area its device reports.
            foreach (var phone in new System.Action<PageShell>[] { shell1 => ZKube.Tests.Presentation.Phones.Compact(shell1), shell1 => ZKube.Tests.Presentation.Phones.Seeker(shell1) })
            {
                app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                yield return ActionsOnScreen(phone);
            }
        }
        private IEnumerator ActionsOnScreen(System.Action<PageShell> phone)
        {
            var shell = app.GetComponent<PageShell>(); phone(shell);
            void OnScreen(string button, string page)
            {
                var rect = SkinUi.ScreenRect((RectTransform)FindButton(app, button).transform);
                Assert.That(rect.yMin, Is.GreaterThanOrEqualTo(shell.SafeArea.yMin - .5f), page + ": " + button + " is below the fold");
                Assert.That(rect.yMax, Is.LessThanOrEqualTo(shell.SafeArea.yMax + .5f), page + ": " + button + " is above the screen");
            }
            app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
            app.Flow.Preview(1); yield return Page(StorePage.Level);
            OnScreen("Play", "Level preview");
            var goals = new CampaignGoals { Points = 60, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 };
            // Level 1 has never been starred here, so a starless run says how to open Level 2.
            foreach (var (reason, stars, moves, title, summary) in new[] {
                ((byte)3, (byte)0, 4u, "Run ended", "An ended run keeps no stars."),
                ((byte)2, (byte)1, 0u, "Out of moves", "1 star kept · Level 2 is open"),
                ((byte)2, (byte)3, 6u, "Board full", "2 stars kept · Level 2 is open"),
                ((byte)2, (byte)0, 0u, "Out of moves", "No stars kept · earn one to open Level 2"),
                ((byte)1, (byte)7, 3u, "Level cleared!", "Level 2 is open") })
            {
                app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 12, StarSources = stars, EndReason = reason, MovesLeft = moves, Goals = goals });
                yield return Page(StorePage.Result);
                foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return null;
                Assert.That(Texts(), Does.Contain(title).And.Contain(summary), title);
                Assert.That(Texts().Count(text => text != null && text.IndexOf("try again", StringComparison.OrdinalIgnoreCase) >= 0), Is.LessThanOrEqualTo(1),
                    title + ": only the guardian says to try again");
                foreach (var button in new[] { stars > 0 ? "Continue" : "Retry", stars == 7 ? null : stars > 0 ? "Retry" : "Map" }.Where(name => name != null))
                    OnScreen(button, title);
                Assert.That(Buttons().Any(button => button.name == "Share"), Is.False, title + ": no Share on Campaign");
            }
        }
        // The owner (2026-10-03): on a level's preview, every Campaign result
        // and the Daily result the guardian is the hero: larger than the title
        // plate, grown into the free room, still leaning on its card with its
        // bubble beside it on screen; no scrolling
        // at the emulator default or the Seeker.
        [UnityTest] public IEnumerator TheGuardianIsTheHeroOfThePreviewAndEveryResult()
        {
            var level = Protocol.Realms[0].Levels[0];
            var goals = new CampaignGoals { Points = Protocol.CampaignTargets[0], PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1],
                PrimaryCount = level.Primary[2], SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] };
            var shell = app.GetComponent<PageShell>();
            void Hero(string at, bool scrolls)
            {
                Canvas.ForceUpdateCanvases();
                Rect Of(string name) => SkinUi.ScreenRect(app.GetComponentsInChildren<Image>().Single(image => image.name == name).rectTransform);
                var guardian = Of("Screen guardian"); var plate = Of("Screen title plate"); var bubble = Of("Guardian bubble");
                // A compact phone has no room to spare; it may scroll and keeps its guardian's former size.
                if (!scrolls) Assert.That(plate.width, Is.LessThan(guardian.width), at + ": the title plate is smaller than the guardian");
                Assert.That(bubble.xMin >= shell.SafeArea.xMin - .5f && bubble.xMax <= shell.SafeArea.xMax + .5f, Is.True, at + ": the bubble stays on screen");
                Assert.That(bubble.xMin, Is.GreaterThan(guardian.center.x), at + ": the bubble stands beside the guardian's head");
                if (!scrolls) Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Viewport.rect.height + 1), at + ": nothing scrolls");
            }
            foreach (var (phone, name, scrolls) in new (System.Action<PageShell>, string, bool)[] {
                (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640", true),
                (value => ZKube.Tests.Presentation.Phones.EmulatorDefault(value), "emulator default", false),
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker", false) })
            {
                phone(shell);
                try
                {
                    app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                    app.Flow.Preview(1); yield return Page(StorePage.Level);
                    Hero(name + " preview", scrolls);
                    foreach (var (reason, stars, moves) in new[] { ((byte)3, (byte)0, 4u), ((byte)2, (byte)1, 0u), ((byte)2, (byte)3, 6u), ((byte)2, (byte)0, 0u), ((byte)1, (byte)7, 3u) })
                    {
                        app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 12, StarSources = stars, EndReason = reason, MovesLeft = moves, Goals = goals });
                        yield return Page(StorePage.Result);
                        foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                        yield return null;
                        Hero(name + " result " + reason + "/" + stars, scrolls);
                    }
                    product.Write(state => { state.DailyAttempt = new LocalDailyAttempt { DayId = runs.Today().DayId, DailyScore = 840, ObjectiveTotal = 13, Tier = 4, Finished = true }; return state; });
                    app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                    Click(app, "View result"); yield return Page(StorePage.Result);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    Hero(name + " Daily result", scrolls);
                    product.Write(state => { state.DailyAttempt = null; return state; });
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
        }
        // The preview and every Campaign result, as the v3 wireframes draw them
        // for Tiki 1, on the Seeker and a 360 x 640 phone in their safe areas:
        // every text inside its rect and the screen, the pieces apart, and 48 dp
        // buttons on screen.
        [UnityTest] public IEnumerator PreviewAndResultsFitWithTheirTapTargetsOnBothPhones()
        {
            var level = Protocol.Realms[0].Levels[0];
            var goals = new CampaignGoals { Points = Protocol.CampaignTargets[0], PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1],
                PrimaryCount = level.Primary[2], SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] };
            var shell = app.GetComponent<PageShell>();
            foreach (var (phone, name) in new (System.Action<PageShell>, string)[] {
                (value => ZKube.Tests.Presentation.Phones.Seeker(value), "Seeker"), (value => ZKube.Tests.Presentation.Phones.Compact(value), "360 x 640") })
            {
                phone(shell);
                try
                {
                    app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                    app.Flow.Preview(1); yield return Page(StorePage.Level);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, name + " preview");
                    ScreenFits(shell, name + " preview", "Play", "Back to map");
                    // In a player's order: starless runs on a fresh level, its first three
                    // stars (a new best), then runs that keep fewer.
                    product.Write(state => { state.Stars[0] = 0; return state; });
                    typeof(StoreAppFlow).GetField("startingStars", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app.Flow, (byte)0);
                    foreach (var (reason, stars, moves, buttons) in new[] {
                        ((byte)2, (byte)0, 0u, new[] { "Retry", "Map" }),
                        ((byte)3, (byte)0, 5u, new[] { "Retry", "Map" }),
                        ((byte)1, (byte)7, 3u, new[] { "Continue" }),
                        ((byte)2, (byte)3, 0u, new[] { "Continue", "Retry" }),
                        ((byte)2, (byte)4, 0u, new[] { "Continue", "Retry" }) })
                    {
                        if (stars == 7) product.Write(state => { state.Stars[0] = 3; return state; });
                        app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = stars == 7 ? 24u : 8u, StarSources = stars, EndReason = reason,
                            MovesLeft = moves, PrimaryProgress = 4, Goals = goals });
                        yield return Page(StorePage.Result);
                        foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                        yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                        yield return ZKube.Tests.Presentation.Captures.Snap(shell, name + " result " + reason + "-" + stars);
                        ScreenFits(shell, name + " result " + reason + "/" + stars, buttons);
                    }
                }
                finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            }
        }
        // Each outcome speaks the line of the stars it kept, and a met goal's row
        // reads at least its target, as the HUD's plates do.
        [UnityTest] public IEnumerator CampaignResultsSpeakTheirStarsLineAndMetRowsReadTheirTarget()
        {
            var lines = PageCatalog.Load().Realm(1).guardianLines; var level = Protocol.Realms[0].Levels[0];
            var goals = new CampaignGoals { Points = Protocol.CampaignTargets[0], PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1],
                PrimaryCount = level.Primary[2], SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] };
            app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
            foreach (var (reason, stars, said) in new[] {
                ((byte)1, (byte)7, lines.threeStar), ((byte)2, (byte)3, lines.twoStar), ((byte)2, (byte)4, lines.oneStar),
                ((byte)2, (byte)0, lines.incomplete), ((byte)3, (byte)0, lines.incomplete) })
            {
                // A low score with its star lit: the row still reads its target.
                app.Flow.LeaveBoard(new CampaignOutcome { Realm = 1, Level = 1, Score = 3, StarSources = stars, EndReason = reason,
                    MovesLeft = 0, PrimaryProgress = 1, Goals = goals });
                yield return Page(StorePage.Result);
                foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                var shown = app.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy).ToArray();
                Assert.That(shown.Single(text => text.name == "Guardian line").text, Is.EqualTo(said), reason + "/" + stars);
                string Row(string name) => System.Text.RegularExpressions.Regex.Replace(shown.Single(text => text.name == name).text, "<[^>]+>", "");
                Assert.That(Row("Score goal"), Is.EqualTo(((stars & 1) != 0 ? goals.Points : 3u) + "/" + goals.Points), reason + "/" + stars + " score row");
                Assert.That(Row("Primary goal"), Is.EqualTo(((stars & 2) != 0 ? goals.PrimaryCount : 1) + "/" + goals.PrimaryCount), reason + "/" + stars + " primary row");
            }
        }
        private void ScreenFits(PageShell shell, string at, params string[] buttons)
        {
            Canvas.ForceUpdateCanvases();
            var safe = shell.SafeArea; float d = shell.SafeArea.height / (at.StartsWith("Seeker") ? ZKube.Tests.Presentation.Phones.SeekerScreen.height - ZKube.Tests.Presentation.Phones.SeekerTopInsetDp
                : ZKube.Tests.Presentation.Phones.CompactScreen.height - ZKube.Tests.Presentation.Phones.CompactTopInsetDp);
            var texts = app.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)).ToArray();
            foreach (var text in texts)
            {
                text.ForceMeshUpdate();
                var rect = SkinUi.ScreenRect(text.rectTransform);
                Assert.That(text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity).y, Is.LessThanOrEqualTo(rect.height + .5f),
                    at + ": '" + text.text + "' fits its height");
                if (text.textWrappingMode == TextWrappingModes.NoWrap)
                    Assert.That(text.GetPreferredValues(text.text, float.PositiveInfinity, float.PositiveInfinity).x, Is.LessThanOrEqualTo(rect.width + 1),
                        at + ": '" + text.text + "' fits its width");
                Assert.That(rect.xMin >= safe.xMin - .5f && rect.xMax <= safe.xMax + .5f && rect.yMin >= safe.yMin - .5f && rect.yMax <= safe.yMax + .5f, Is.True,
                    at + ": '" + text.text + "' " + rect + " stays in the safe area " + safe);
            }
            var pieces = app.GetComponentsInChildren<Graphic>().Where(image => new[] { "Screen title plate", "Star crown", "Screen card", "Score plate",
                "Wordmark", "Daily card", "Campaign card", "Map header" }.Contains(image.name)).Select(image => SkinUi.ScreenRect(image.rectTransform)).ToList();
            Assert.That(pieces.Count + buttons.Length, Is.GreaterThanOrEqualTo(2), at + " draws its title and its focal piece or action");
            // The guardian's bubble stays above its card.
            var bubble = app.GetComponentsInChildren<Image>().SingleOrDefault(image => image.name == "Guardian bubble");
            if (bubble != null)
            {
                var card = app.GetComponentsInChildren<Image>().Single(image => image.name == "Screen card");
                Assert.That(SkinUi.ScreenRect(bubble.rectTransform).yMin, Is.GreaterThanOrEqualTo(SkinUi.ScreenRect(card.rectTransform).yMax - .5f),
                    at + ": the bubble stays above the card");
            }
            foreach (var button in buttons)
            {
                var found = FindButton(app, button);
                var rect = SkinUi.ScreenRect((RectTransform)found.transform);
                Assert.That(rect.height / d, Is.GreaterThanOrEqualTo(48 - .01f), at + ": " + button + " is 48 dp to touch");
                var icon = found.GetComponentsInChildren<Image>().FirstOrDefault(image => image.name.EndsWith(" icon"));
                var word = found.GetComponentInChildren<TMP_Text>();
                if (icon != null && word != null)
                {
                    word.ForceMeshUpdate();
                    float ink = word.transform.TransformPoint(word.textBounds.min).x;
                    Assert.That(ink, Is.GreaterThanOrEqualTo(SkinUi.ScreenRect(icon.rectTransform).xMax - .5f), at + ": " + button + "'s word clears its icon");
                }
                Assert.That(rect.yMin >= safe.yMin - .5f && rect.yMax <= safe.yMax + .5f, Is.True, at + ": " + button + " is on screen");
                // A card's own button sits inside it, as the wireframes place Play today and Play level N.
                bool carded = pieces.Any(piece => piece.Contains(rect.min + Vector2.one * .5f) && piece.Contains(rect.max - Vector2.one * .5f));
                if (button != "Back to map" && !carded) pieces.Add(rect);
            }
            for (int a = 0; a < pieces.Count; a++) for (int b = a + 1; b < pieces.Count; b++)
                Assert.That(pieces[a].Overlaps(pieces[b]), Is.False, at + ": pieces " + pieces[a] + " and " + pieces[b] + " stay apart");
        }
        // Home, as the v3 composite draws it, on both phones: the lockup, the two
        // cards and the two plays over the four tabs, every word fitting and
        // each play 48 dp to touch. The objective's pictogram sits left of its
        // caption, and "left" right after the clock.
        [UnityTest] public IEnumerator HomeFitsOnBothPhones()
        {
            var shell = app.GetComponent<PageShell>();
            try
            {
                foreach (bool compact in new[] { false, true })
                {
                    if (compact) ZKube.Tests.Presentation.Phones.Compact(shell); else ZKube.Tests.Presentation.Phones.Seeker(shell);
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    string at = compact ? "360 x 640 home" : "Seeker home";
                    ScreenFits(shell, at, "Play today", "Play level 1");
                    Assert.That(Texts(), Does.Contain("CAMPAIGN"), at + ": the Campaign card is titled Campaign");
                    Rect Drawn(string name) => SkinUi.ScreenRect(app.GetComponentsInChildren<Graphic>().Single(graphic => graphic.name == name).rectTransform);
                    var picture = Drawn("Daily objective pictogram"); var line = Drawn("Daily line");
                    Assert.That(picture.xMax, Is.LessThanOrEqualTo(line.xMin), at + ": the pictogram is left of its caption");
                    Assert.That(picture.yMin < line.yMax && picture.yMax > line.yMin, Is.True, at + ": the pictogram and its caption share a line");
                    var number = app.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Daily countdown number");
                    var left = app.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Daily countdown words");
                    number.ForceMeshUpdate();
                    float gap = SkinUi.ScreenRect(left.rectTransform).xMin - (SkinUi.ScreenRect(number.rectTransform).xMin + number.textBounds.max.x);
                    float d = shell.SafeArea.height / (compact ? 572 : 882);
                    Assert.That(gap / d, Is.InRange(2f, 9f), at + ": \"left\" sits right after the clock");
                    var tabs = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
                    Assert.That(SkinUi.ScreenRect((RectTransform)FindButton(app, "Play today").transform).yMin, Is.GreaterThanOrEqualTo(tabs.yMax), at + ": the plays sit above the tabs");
                    Assert.That(shell.Chrome.GetComponentInChildren<SkinTabBar>().GetComponentsInChildren<Button>().Length, Is.EqualTo(4), at + ": four tabs");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, at);
                }
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
        }
        // The map greeting, its rule page, the profile and settings, as the v3
        // composites draw them, on both phones: every word fits in the safe area
        // and each action is 48 dp to touch.
        [UnityTest] public IEnumerator GreetingRuleProfileAndSettingsFitOnBothPhones()
        {
            var shell = app.GetComponent<PageShell>();
            product.Write(state => { state.Stars[9] = 1; state.WornEmblem = 1; return state; });
            // The composite's levels: music at 20% and effects at 40%.
            board.SetMusicVolume(.2); board.SetEffectsVolume(.4); board.SetMuted(false);
            try
            {
                foreach (bool compact in new[] { false, true })
                {
                    if (compact) ZKube.Tests.Presentation.Phones.Compact(shell); else ZKube.Tests.Presentation.Phones.Seeker(shell);
                    string phone = compact ? "360 x 640" : "Seeker";
                    var safe = shell.SafeArea; float d = safe.height / (compact ? 572 : 882);
                    void Fits(IEnumerable<TMP_Text> texts, string at)
                    {
                        Canvas.ForceUpdateCanvases();
                        texts = texts.Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)).ToArray();
                        foreach (var text in texts)
                        {
                            text.ForceMeshUpdate();
                            var rect = SkinUi.ScreenRect(text.rectTransform);
                            Assert.That(text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity).y, Is.LessThanOrEqualTo(rect.height + .5f), at + ": '" + text.text + "' fits");
                            if (text.textWrappingMode == TextWrappingModes.NoWrap)
                                Assert.That(text.GetPreferredValues(text.text, float.PositiveInfinity, float.PositiveInfinity).x, Is.LessThanOrEqualTo(rect.width + 1),
                                    at + ": '" + text.text + "' fits its width");
                            Assert.That(rect.xMin >= safe.xMin - .5f && rect.xMax <= safe.xMax + .5f && rect.yMin >= safe.yMin - .5f && rect.yMax <= safe.yMax + .5f,
                                Is.True, at + ": '" + text.text + "' stays in the safe area");
                        }
                    }
                    void Touch(string name, string at) =>
                        Assert.That(SkinUi.ScreenRect((RectTransform)FindButton(app, name).transform).height / d, Is.GreaterThanOrEqualTo(48 - .01f), at + ": " + name);
                    // The greeting and its rule page.
                    greeted = 0;
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    var greeting = shell.Chrome.Find("Guardian greeting");
                    var talk = greeting.GetComponentInChildren<GuardianTalk>(); talk.Complete();
                    Fits(greeting.GetComponentsInChildren<TMP_Text>(), phone + " greeting");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, phone + " greeting");
                    Click(app, "Continue"); yield return null;
                    Fits(greeting.GetComponentsInChildren<TMP_Text>(), phone + " greeting rule");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, phone + " greeting rule");
                    Click(app, "Continue"); yield return null;
                    // The profile and settings, their tab labels counted.
                    app.Flow.Show(StorePage.Profile); yield return Page(StorePage.Profile);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    Fits(app.GetComponentsInChildren<TMP_Text>(), phone + " profile");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, phone + " profile");
                    app.Flow.Show(StorePage.Settings); yield return Page(StorePage.Settings);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                    Fits(app.GetComponentsInChildren<TMP_Text>(), phone + " settings");
                    foreach (var name in new[] { "Music switch", "Effects switch", "Text size: standard", "Restore purchases" }) Touch(name, phone + " settings");
                    yield return ZKube.Tests.Presentation.Captures.Snap(shell, phone + " settings");
                }
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
        }
        // Every screen has the full-scene painting behind it, as the composites
        // draw them: the realm's painting covering the screen under the veil
        // (the map and the preview draw the map painting), and a scrim only on the
        // screens drawn over it, the preview and the results.
        [UnityTest] public IEnumerator EveryScreenHasItsFullScenePaintingUnderTheVeil()
        {
            var shell = app.GetComponent<PageShell>();
            void Painted(string at, string slot, bool scrim)
            {
                Assert.That(shell.Background.color.a, Is.EqualTo(1).Within(.001f), at + ": the page has settled");
                Assert.That(shell.Background.sprite, Is.SameAs(shell.Artwork.SkinRealm(slot)), at + " draws its " + slot + " painting");
                Assert.That(shell.Background.color.r + shell.Background.color.g + shell.Background.color.b, Is.EqualTo(3).Within(.001f), at + " at full strength");
                var painting = SkinUi.ScreenRect(shell.Background.rectTransform); var screen = shell.ScreenArea;
                Assert.That(painting.xMin <= screen.xMin + .5f && painting.xMax >= screen.xMax - .5f && painting.yMin <= screen.yMin + .5f && painting.yMax >= screen.yMax - .5f,
                    Is.True, at + ": the painting covers the screen");
                Assert.That(shell.Veil.enabled, Is.True, at + " is veiled");
                Assert.That(shell.Scrim.enabled, Is.EqualTo(scrim), at + (scrim ? " is drawn over the painting" : " shows the painting"));
            }
            IEnumerator Settled(StorePage page) { yield return Page(page); yield return new WaitForSecondsRealtime(1); }
            app.Flow.Show(StorePage.Home); yield return Settled(StorePage.Home); Painted("Home", SkinSlots.Background, false);
            app.Flow.Show(StorePage.Campaign); yield return Settled(StorePage.Campaign); Painted("Map", SkinSlots.Map, false);
            app.Flow.Preview(1); yield return Settled(StorePage.Level); Painted("Preview", SkinSlots.Map, true);
            app.Flow.Show(StorePage.Profile); yield return Settled(StorePage.Profile); Painted("Profile", SkinSlots.Background, false);
            app.Flow.Show(StorePage.Settings); yield return Settled(StorePage.Settings); Painted("Settings", SkinSlots.Background, false);
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady(); yield return EndRun(); yield return Page(StorePage.Result);
            yield return new WaitForSecondsRealtime(1); Painted("Daily result", SkinSlots.Background, true);
            // The veil darkens the top and bottom as the composites' gradient does.
            CollectionAssert.AreEqual(new[] { (0f, .667f), (.3f, .333f), (.7f, .533f), (1f, .8f) }, PageShell.VeilStops);
        }
        // The screens drawn over the painting still show the scene above their
        // card, as the approved composites do: the top third of the Tiki preview
        // and of an ended run's result is as bright as tiki-preview-seeker.png
        // (0.160 mean luminance) and tiki-resEnded-seeker.png (0.172), within a
        // quarter.
        [UnityTest] public IEnumerator TheSceneReadsAboveThePreviewAndResultCards()
        {
            var shell = app.GetComponent<PageShell>();
            ZKube.Tests.Presentation.Phones.Seeker(shell);
            try
            {
                IEnumerator TopThird(string at, float composite)
                {
                    foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                    yield return new WaitForSecondsRealtime(1); yield return new WaitForEndOfFrame();
                    var area = shell.ScreenArea; int width = (int)area.width, third = (int)(area.height / 3);
                    var texture = new Texture2D(width, third, TextureFormat.RGB24, false);
                    try
                    {
                        texture.ReadPixels(new Rect(area.x, area.yMax - third, width, third), 0, 0); texture.Apply();
                        float luminance = texture.GetPixels().Average(pixel => .2126f * pixel.r + .7152f * pixel.g + .0722f * pixel.b);
                        Assert.That(luminance, Is.InRange(composite * .75f, composite * 1.25f), at + ": the scene above the card reads as the composite's does");
                    }
                    finally { UnityEngine.Object.Destroy(texture); }
                }
                app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                app.Flow.Preview(1); yield return Page(StorePage.Level);
                yield return TopThird("Tiki preview", .160f);
                Click(app, "Play"); yield return BoardReady(); yield return EndRun(); yield return Page(StorePage.Result);
                yield return TopThird("Tiki ended result", .172f);
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
        }
        // Every level's preview has its own line: the guardian's trial line on its
        // own level, and no two neighbouring levels share one.
        [UnityTest] public IEnumerator EachLevelPreviewSpeaksItsOwnLine()
        {
            product.Write(state => { for (int level = 0; level < 9; level++) state.Stars[level] = 1; return state; });
            var lines = PageCatalog.Load().Realm(1).guardianLines; string previous = null;
            app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
            for (byte level = 1; level <= 10; level++)
            {
                app.Flow.Preview(level); yield return Page(StorePage.Level);
                // The previous preview leaves on its own layer; read the shown one.
                yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                var spoken = app.GetComponentsInChildren<TMP_Text>().Where(text => text.name == "Guardian line").ToArray();
                string Path(Transform t) => t == null || t == app.transform ? "" : Path(t.parent) + "/" + t.name;
                Assert.That(spoken.Length, Is.EqualTo(1), string.Join(", ", spoken.Select(text => Path(text.transform))));
                string said = spoken[0].text;
                if (level == 10) Assert.That(said, Is.EqualTo(lines.trialIntro));
                else Assert.That(said, Is.Not.EqualTo(previous), "Level " + level + " repeats level " + (level - 1));
                Assert.That(app.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Level talk rule heading" && !string.IsNullOrEmpty(text.text)), Is.False,
                    "The preview speaks only its line, as drawn");
                previous = said;
                Click(app, "Back to map"); yield return Page(StorePage.Campaign);
            }
        }
        // Settings is the fourth tab and Home has no gear; settings toggles carry
        // no On or Off words beside them.
        [UnityTest] public IEnumerator SettingsIsATabAndTogglesSpeakForThemselves()
        {
            Assert.That(app.GetComponentsInChildren<Image>().Any(image => image.name == "Settings icon"), Is.False, "Home has no settings gear");
            Assert.That(FindButton(app, "Settings").transform.IsChildOf(app.GetComponent<PageShell>().Chrome), Is.True, "Settings is a tab");
            app.Flow.Show(StorePage.Settings); yield return Page(StorePage.Settings);
            foreach (var row in new[] { "Haptics", "Reduced motion" })
                Assert.That(app.GetComponentsInChildren<TMP_Text>().Where(text => text.name.StartsWith(row)).Select(text => text.text),
                    Has.None.EqualTo("On").And.None.EqualTo("Off"), row);
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
        // Each open node shows its level number on one line, inside the node's
        // touch area, at both text sizes; a locked node shows its lock.
        private static void AssertNodeCaptions(Button[] nodes)
        {
            foreach (var node in nodes)
            {
                var caption = node.GetComponentInChildren<TMP_Text>();
                Assert.That(caption != null || node.GetComponentsInChildren<Image>().Any(image => image.name == node.name + " lock"), Is.True, node.name);
                if (caption == null) continue;
                caption.ForceMeshUpdate();
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
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady();
            var retainedArt = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            yield return EndRun(); yield return Page(StorePage.Result);
            var leases = (System.Collections.IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var before = leases.Keys.Cast<string>().Where(key => key.Contains("/theme-")).ToHashSet();
            product.Write(state => { for (int realm = 1; realm <= 10; realm++) state.Stars[realm * 10 - 1] = 1; return state; });
            Click(app, "Continue"); yield return Page(StorePage.Home);
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
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
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
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady(); failSave = true;
            Click(board.View, "Pause"); Click(board.View, "End run"); yield return null; Click(board.View, "End run");
            yield return Wait(() => board.RecoveryRequired && !board.Busy, "Expected recovery after accepted save failure");
            yield return Wait(() => WarningVisible, "Unsaved overlay was not shown over the board");
            Click(board.View, "Recover run"); yield return Wait(() => !board.RecoveryRequired && !board.Busy, "Accepted snapshot was not recovered");
            Assert.That(WarningVisible, Is.True); yield return Page(StorePage.Result);
            Assert.That(WarningVisible, Is.True); Assert.That(product.Read.DailyAttempt.Finished, Is.True);
        }
        [UnityTest] public IEnumerator SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount()
        {
            Click(app, "Settings"); yield return Page(StorePage.Settings);
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
            Click(app, "Home"); yield return Page(StorePage.Home); Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "Music switch"); yield return Page(StorePage.Settings); Assert.That(board.MusicVolume, Is.EqualTo(AudioPolicy.ToggleOnLevel));
        }
    }
}
