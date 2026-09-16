using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    // Explicit composition only: the root-owned startup supplies the one local
    // store/client/billing lifetime and the board instance. No runtime installer.
    public sealed class StoreAppAdapter : MonoBehaviour, IAppPageSource
    {
        public StoreAppFlow Flow { get; private set; }
        private BoardController board;
        private AppShell shell;
        private AppPages shared;
        private BoardArt art => shell.Artwork;
        private GameObject pageRoot, warningRoot;
        private RectTransform content;
        private TMP_Text warning;
        private bool loading, dirty, lastBusy, lastUnsaved;
        private uint lastDay;
        private LocalProductState lastProduct;
        private Rect lastSafe;
        private Vector2Int lastSize;
        private Exception lastFulfillment;
        private PageCatalog pages;
        private float TextScale => board.TextScale > 1 ? 1.3f : 1;

        public void Initialize(LocalProductStore product, StoreRunClient runs, CampaignBilling billing, BoardController boardController)
        {
            if (Flow != null) throw new InvalidOperationException("Store app was already initialized");
            board = boardController ?? throw new ArgumentNullException(nameof(boardController));
            Flow = new StoreAppFlow(product, runs, billing);
            if (EventSystem.current == null || EventSystem.current.transform.IsChildOf(board.transform))
                throw new InvalidOperationException("Startup must create a shared EventSystem outside the board object");
            shell = gameObject.AddComponent<AppShell>(); shell.Initialize(Application.productName);
            pageRoot = shell.Root; content = shell.Content;
            shared = gameObject.AddComponent<AppPages>();
            var font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular");
            shared.Initialize(this, font, font, TextScale);
            Flow.Changed += Refresh; Flow.BoardOpened += OpenBoard;
            board.Host = new BoardHostHooks { Exit = ExitBoard, Accepted = Accepted, Rejected = Rejected };
            board.gameObject.SetActive(false);
            warningRoot = CanvasRoot("Unsaved progress", 80);
            var banner = Rect("Save warning", warningRoot.transform);
            banner.anchorMin = new Vector2(0, 1); banner.anchorMax = Vector2.one; banner.pivot = new Vector2(.5f, 1);
            banner.sizeDelta = new Vector2(0, 76); banner.gameObject.AddComponent<Image>().color = new Color(.35f, .12f, .03f, .98f);
            warning = Label(banner, "Progress is not saved. Keep the app open; closing it may lose this result.", 18, 68);
            Stretch(warning.rectTransform, 14);
            warningRoot.SetActive(false); Refresh();
            _ = Flow.RefreshBilling();
        }
        private void Update()
        {
            if (Flow == null) return;
            Flow.ObservePersistence();
            var today = Flow.Today.DayId;
            bool busy = Flow.Billing.Busy;
            if (!ReferenceEquals(lastProduct, Flow.Product.Read) || lastDay != today || lastBusy != busy ||
                lastUnsaved != Flow.Unsaved || lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height) ||
                !ReferenceEquals(lastFulfillment, Flow.Billing.LastFulfillmentError))
            {
                lastProduct = Flow.Product.Read; lastDay = today; lastBusy = busy; lastUnsaved = Flow.Unsaved;
                lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
                lastFulfillment = Flow.Billing.LastFulfillmentError; Refresh();
            }
            if (dirty && !loading && Flow.Page != StorePage.Board) StartCoroutine(Render());
        }
        private byte PageRealm => Flow.Page == StorePage.Daily ? Flow.Today.Realm :
            Flow.Page == StorePage.Result && Flow.Product.Read.DailyAttempt != null ? NativeEngine.Daily(Flow.Product.Read.DailyAttempt.DayId).Realm :
            Flow.Page == StorePage.Profile ? (byte)Math.Max(1, Flow.Product.Read.WornEmblem) : Flow.Realm;
        private void Refresh()
        {
            if (this == null || Flow == null) return;
            dirty = true;
            shell.Show(Flow.Page != StorePage.Board);
            if (warningRoot != null)
            {
                warningRoot.SetActive(Flow.Unsaved);
                var rect = (RectTransform)warning.transform.parent;
                rect.anchorMin = new Vector2(Screen.safeArea.xMin / Screen.width, Screen.safeArea.yMax / Screen.height);
                rect.anchorMax = new Vector2(Screen.safeArea.xMax / Screen.width, Screen.safeArea.yMax / Screen.height);
                rect.anchoredPosition = Vector2.zero;
            }
        }
        private IEnumerator Render()
        {
            loading = true; dirty = false;
            byte realm = PageRealm; StorePage page = Flow.Page;
            if (!shell.RealmReady(realm))
            {
                RetirePage(); shell.RequestRealm(realm);
                while (shell.Loading) yield return null;
                if (shell.ArtworkError != null) { loading = false; DrawLoadError(shell.ArtworkError); yield break; }
            }
            loading = false;
            if (this == null || Flow == null) yield break;
            if (Flow.Page != page || PageRealm != realm) { dirty = true; yield break; }
            try { Draw(); }
            catch (Exception error) { DrawLoadError(error); }
        }
        private void DrawLoadError(Exception error)
        {
            // A missing imported asset is an explicit retry page, not an
            // exception-driven per-frame load loop.
            dirty = false;
            RetirePage();
            Text("This page could not be opened.", 28, true); Text(error.Message, 18);
            Button(content, "Try again", () => { shell.ReleaseArtwork(); Refresh(); });
        }
        private void Draw()
        {
            if (pages == null) pages = PageCatalog.Load();
            RetirePage();
            shared.Initialize(this, art.Display, art.Body, TextScale);
            shell.Background.sprite = art.Sprite("background"); shell.Background.color = new Color(.4f, .4f, .4f);
            shared.Render((AppPage)Enum.Parse(typeof(AppPage), Flow.Page.ToString()), content);
            if (!string.IsNullOrEmpty(Flow.Error)) Text(Flow.Error, 19);
            if (Flow.Billing.Busy) Text("A store operation is still in progress.", 18);
            else if (!string.IsNullOrEmpty(Flow.BillingNotice)) Text(Flow.BillingNotice, 18);
            if (Flow.Billing.LastFulfillmentError != null) Text("Store confirmation needs attention. Restore purchases to retry.", 18);
            shared.Navigation(content);
        }
        private static PageAction Action(string label, Action invoke, bool enabled = true) =>
            new PageAction { Label = label, Invoke = invoke, Enabled = enabled };
        public CampaignPageView CampaignView()
        {
            var active = Flow.Runs.Active("campaign"); string locked = Flow.Runs.CampaignLock(Flow.Realm);
            return new CampaignPageView {
                Realm = Flow.Realm, Stars = Flow.Stars(Flow.Realm),
                Previous = Action("Previous", () => Flow.SelectRealm((byte)(Flow.Realm - 1)), Flow.Realm > 1),
                Next = Action("Next", () => Flow.SelectRealm((byte)(Flow.Realm + 1)), Flow.Realm < Protocol.Realms.Length),
                Notice = locked == "stars" ? "Clear the previous realm's final trial to unlock this path." : null,
                Purchase = locked == "purchase" ? Action("Unlock the full Campaign" +
                    (Flow.Product.Read.CampaignPrice == null ? "" : " · " + Flow.Product.Read.CampaignPrice),
                    () => _ = Flow.RefreshBilling(purchase: true), !Flow.Billing.Busy) : null,
                Trials = Enumerable.Range(1, Protocol.CampaignTargets.Length).Select(index => {
                    byte level = (byte)index;
                    return new CampaignTrialView { Level = level,
                        Stars = Flow.Product.Read.Stars[(Flow.Realm - 1) * Protocol.CampaignTargets.Length + level - 1],
                        Available = Flow.LevelAvailable(Flow.Realm, level), Playing = active?.Realm == Flow.Realm && active.Level == level,
                        Open = () => Flow.Preview(level) };
                }).ToArray()
            };
        }
        public LevelPageView LevelPage()
        {
            var level = Protocol.Realms.Single(value => value.MapId == Flow.Realm).Levels[Flow.Level - 1];
            return new LevelPageView { Realm = Flow.Realm, Level = Flow.Level,
                Stars = Flow.Product.Read.Stars[(Flow.Realm - 1) * Protocol.CampaignTargets.Length + Flow.Level - 1],
                Moves = NativeEngine.CampaignMoveBudget(Flow.Level, level.Tier),
                Score = Protocol.CampaignTargets[Flow.Level - 1] + " points",
                Primary = BoardView.ObjectiveName(level.Primary[0], level.Primary[1]) + " · " + level.Primary[2],
                Secondary = BoardView.ObjectiveName(level.Secondary[0], level.Secondary[1]) + " · " + level.Secondary[2],
                Play = Action(Flow.Runs.Active("campaign") == null ? "Play" : "Resume run", Flow.PlayCampaign),
                Back = Action("Back to map", () => Flow.Show(StorePage.Campaign)) };
        }
        public DailyPageView DailyPage()
        {
            var today = Flow.Today;
            return new DailyPageView { Day = today.DayId, Realm = today.Realm,
                ObjectiveKind = today.ObjectiveKind, ObjectiveValue = today.ObjectiveValue,
                Facts = new[] { "One attempt today. Play it while the app stays open." },
                Actions = new[] { Action(Flow.DailyAction, Flow.PlayDaily) } };
        }
        public ProfilePageView ProfilePage()
        {
            var state = Flow.Product.Read;
            return new ProfilePageView { Name = state.Name, ChangeName = Flow.SetName, Realm = (byte)Math.Max(1, state.WornEmblem),
                Stars = state.Stars.Sum(value => (int)value), Streak = state.Streak, BestDailyScore = state.BestDailyScore,
                Emblems = Protocol.Realms.Where(realm => Flow.Cleared(realm.MapId)).Select(realm => {
                    byte id = realm.MapId;
                    return new ProfileChoiceView { Id = id, Realm = id, Name = pages.Realm(id).guardianName,
                        Detail = state.WornEmblem == id ? "Worn" : null, Available = true, Select = () => Flow.Wear(id) };
                }).ToArray(),
                Restore = Action("Restore purchases", () => _ = Flow.RefreshBilling(), !Flow.Billing.Busy) };
        }
        public SettingsPageView SettingsPage() => AppPreferences.Read(Refresh, board);
        public ResultPageView ResultPage()
        {
            var attempt = Flow.Product.Read.DailyAttempt;
            var pair = attempt == null ? null : NativeEngine.Daily(attempt.DayId);
            return new ResultPageView { ProductName = Application.productName, Mode = "Daily", PlayerName = Flow.Product.Read.Name,
                HasResult = attempt != null, Realm = pair?.Realm ?? 1, Day = attempt?.DayId ?? 0,
                ObjectiveKind = pair?.Kind ?? 0, ObjectiveValue = pair?.Value ?? 0,
                Score = attempt?.DailyScore ?? 0,
                ObjectiveTotal = attempt?.ObjectiveTotal ?? 0,
                Streak = Flow.Product.Read.Streak,
                Notice = attempt != null && !attempt.Finished ? "Attempt used. This run is no longer open in this app session." : null,
                NativeSharing = ResultSharing.NativeAvailable, Share = ResultSharing.Open,
                Done = Action("Done", () => Flow.Show(StorePage.Daily)) };
        }
        public bool CanNavigate(AppPage page) => Flow != null && Flow.Page != StorePage.Board;
        public void Navigate(AppPage page) => Flow.Show((StorePage)Enum.Parse(typeof(StorePage), page.ToString()));
        public IReadOnlyList<PageAction> IdentityNavigation => Array.Empty<PageAction>();
        public void Report(Exception error) => Flow.Report(error);
        private TMP_Text Text(string value, float size = 22, bool display = false) => Label(content, value, size, 0, display);
        private TMP_Text Label(Transform parent, string value, float size, float height, bool display = false)
        { var label = shared.Label(parent, value, size, display); if (height > 0) label.GetComponent<LayoutElement>().minHeight = height; return label; }
        private Button Button(Transform parent, string label, Action action, bool enabled = true) => shared.Button(parent, Action(label, action, enabled));
        private void OpenBoard(LocalBoardActionProvider provider)
        { board.gameObject.SetActive(true); board.Bind(provider.Bind(null)); if (pageRoot != null) pageRoot.SetActive(false); }
        private void ExitBoard() { board.gameObject.SetActive(false); Flow.LeaveBoard(); }
        private void Accepted(CoreRunToken _) { Flow.ObservePersistence(); Refresh(); }
        private void Rejected(string _) { Flow.ObservePersistence(); Refresh(); }
        private void OnApplicationPause(bool paused) { if (!paused && Flow != null) { Refresh(); _ = Flow.RefreshBilling(); } }
        private static RectTransform Rect(string name, Transform parent)
        { var value = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); value.SetParent(parent, false); return value; }
        private static void Stretch(RectTransform rect, float inset = 0)
        { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = Vector2.one * inset; rect.offsetMax = -Vector2.one * inset; }
        private static void Height(RectTransform rect, float height)
        { var layout = rect.gameObject.AddComponent<LayoutElement>(); layout.minHeight = layout.preferredHeight = height; layout.flexibleWidth = 1; }
        private GameObject CanvasRoot(string name, int order) => AppShell.CanvasRoot(name, transform, order);
        private void RetirePage()
        {
            shared.Retire(); shell.Background.sprite = null; shell.Clear();
        }
        private void OnDestroy()
        {
            if (Flow != null) { Flow.Changed -= Refresh; Flow.BoardOpened -= OpenBoard; Flow.Dispose(); Flow = null; }
            if (board != null) board.Host = null;
            RetirePage(); shell.ReleaseArtwork();
        }
    }
}
