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
        private RunBoard runBoard;
        private BoardController board => runBoard.Board;
        private PageShell shell;
        private PageViews views;
        private bool loading, dirty, lastBusy, lastUnsaved;
        private uint lastDay;
        private LocalProductState lastProduct;
        private PlayerAccount lastAccount;
        private Rect lastSafe;
        private Vector2Int lastSize;
        private Exception lastFulfillment;
        private float TextScale => board.TextScale > 1 ? 1.3f : 1;

        public void Initialize(LocalProductStore product, StoreRunClient runs, CampaignBilling billing, BoardController boardController,
            IPlayerAccounts accounts = null)
        {
            if (Flow != null) throw new InvalidOperationException("Store app was already initialized");
            if (boardController == null) throw new ArgumentNullException(nameof(boardController));
            runBoard = gameObject.AddComponent<RunBoard>(); runBoard.Initialize(boardController, () => Flow.LeaveHome());
            Flow = new StoreAppFlow(product, runs, billing, accounts);
            if (EventSystem.current == null || EventSystem.current.transform.IsChildOf(board.transform))
                throw new InvalidOperationException("Startup must create a shared EventSystem outside the board object");
            shell = gameObject.AddComponent<PageShell>(); shell.Initialize(Application.productName);
            views = gameObject.AddComponent<PageViews>(); views.Initialize(this, shell, "Home", "realms", TextScale);
            Flow.Changed += Refresh; Flow.BoardOpened += OpenBoard;
            Refresh();
            _ = Flow.RefreshBilling(); _ = Flow.SignIn();
        }
        private void Update()
        {
            if (Flow == null) return;
            Flow.ObservePersistence();
            var today = Flow.Today.DayId;
            bool busy = Flow.Billing.Busy;
            if (!ReferenceEquals(lastProduct, Flow.Product.Read) || lastDay != today || lastBusy != busy ||
                lastUnsaved != Flow.Unsaved || !ReferenceEquals(lastAccount, Flow.Account) || lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height) ||
                !ReferenceEquals(lastFulfillment, Flow.Billing.LastFulfillmentError))
            {
                lastProduct = Flow.Product.Read; lastAccount = Flow.Account; lastDay = today; lastBusy = busy; lastUnsaved = Flow.Unsaved;
                lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
                lastFulfillment = Flow.Billing.LastFulfillmentError; Refresh();
            }
            if (dirty && !loading && Flow.Page != StorePage.Board) StartCoroutine(Render());
        }
        private byte PageRealm => Flow.Page == StorePage.Home ? Flow.Today.Realm :
            Flow.Page == StorePage.Result && Flow.Campaign.Last != null ? Flow.Campaign.Last.Realm :
            Flow.Page == StorePage.Result && Flow.Product.Read.DailyAttempt != null ? NativeEngine.Daily(Flow.Product.Read.DailyAttempt.DayId).Realm :
            Flow.Page == StorePage.Profile ? WornRealm : Flow.Campaign.Realm;
        // The realm behind the profile: the worn guardian's, or the first realm.
        private byte WornRealm => (byte)(ProfileEmblems.All.FirstOrDefault(emblem => emblem.Id == Flow.Product.Read.WornEmblem)?.Realm is byte realm && realm > 0 ? realm : 1);
        private void Refresh()
        {
            if (this == null || Flow == null) return;
            dirty = true;
            if (Flow.Page != StorePage.Board) shell.Show(true);
        }
        // A new page, or the same page in another realm: the drawn page stays
        // whole while the next one's art loads, then leaves as the next is drawn.
        private IEnumerator Render()
        {
            loading = true; dirty = false;
            byte realm = PageRealm; StorePage page = Flow.Page;
            bool load = !shell.RealmReady(realm);
            if (load)
            {
                shell.RequestRealm(realm);
                while (shell.Loading) yield return null;
                if (shell.ArtworkError != null) { loading = false; DrawLoadError(shell.ArtworkError); yield break; }
            }
            loading = false;
            if (this == null || Flow == null) yield break;
            if (Flow.Page != page || PageRealm != realm) { dirty = true; yield break; }
            if (load || views.Shown.HasValue && views.Shown.Value.ToString() != page.ToString())
                shell.Depart(board.ReducedMotion, Mathf.Max(.5f, BoardController.ReadDisplayDensity()));
            try { Draw(); }
            catch (Exception error) { DrawLoadError(error); }
        }
        private void DrawLoadError(Exception error)
        {
            // A missing imported asset is an explicit retry page, not an
            // exception-driven per-frame load loop.
            dirty = false;
            RetirePage();
            views.Unavailable("This page could not be opened.", error.Message, Action("Try again", () => { shell.ReleaseArtwork(); Refresh(); }));
        }
        private void Draw()
        {
            views.Initialize(this, shell, "Home", "realms", TextScale);
            views.Render((AppPage)Enum.Parse(typeof(AppPage), Flow.Page.ToString()), Notices());
        }
        private IEnumerable<string> Notices()
        {
            yield return Flow.Error;
            if (Flow.Unsaved) yield return RunBoard.UnsavedWarning;
            // Store status belongs where its purchase and restore actions are.
            if (Flow.Page != StorePage.Campaign && Flow.Page != StorePage.Level && Flow.Page != StorePage.Settings) yield break;
            // The Campaign page states an unreachable store in place of its purchase.
            yield return Flow.Billing.Busy ? "A store operation is still in progress." :
                Flow.Page == StorePage.Campaign && Flow.StoreUnavailable ? null : Flow.BillingNotice;
            if (Flow.Billing.LastFulfillmentError != null) yield return "Store confirmation needs attention. Restore purchases to retry.";
        }
        // The profile's name without a platform account: a fixed label, not a name to edit.
        public const string SignedOutName = "Player";
        private static PageAction Action(string label, Action invoke, bool enabled = true) =>
            new PageAction { Label = label, Invoke = invoke, Enabled = enabled };
        // The shared map, with the store's purchase where the purchase closes the realm.
        public CampaignPageView CampaignView()
        {
            var view = Flow.Campaign.CampaignView();
            if (Flow.Runs.CampaignLock(view.Realm) != "purchase") return view;
            bool offline = Flow.StoreUnavailable;
            view.Locked = "Realms " + StoreCampaignPolicy.FirstPurchasedRealm + "–" + Protocol.Realms.Length + " open with the full Campaign purchase.";
            view.StoreProblem = offline ? "Store purchase unavailable" : null;
            view.Purchase = offline ? Action("Try again", () => _ = Flow.RefreshBilling(), !Flow.Billing.Busy) :
                Action("Unlock full Campaign" + (Flow.Product.Read.CampaignPrice == null ? "" : " · " + Flow.Product.Read.CampaignPrice),
                    () => _ = Flow.RefreshBilling(purchase: true), !Flow.Billing.Busy);
            view.Restore = offline ? null : Action("Restore purchases", () => _ = Flow.RefreshBilling(), !Flow.Billing.Busy);
            return view;
        }
        public CampaignSummaryView CampaignSummary() => Flow.Campaign.CampaignSummary();
        public LevelPageView LevelPage() => Flow.Campaign.LevelPage();
        public DailyPageView DailyPage()
        {
            var today = Flow.Today;
            var attempt = Flow.AttemptedToday && Flow.TodayRun == null ? Flow.Product.Read.DailyAttempt : null;
            // The local Daily closes as the next one opens.
            return new DailyPageView { Day = today.DayId, Realm = today.Realm, ClosesAt = today.FreezesAt, Now = Flow.Runs.Now,
                NextOpensAt = attempt == null ? 0 : today.FreezesAt, Score = attempt?.DailyScore ?? 0, ObjectiveTotal = attempt?.ObjectiveTotal ?? 0,
                ObjectiveKind = today.ObjectiveKind, ObjectiveValue = today.ObjectiveValue,
                Actions = Flow.HasLeaderboard ? new[] { Action(Flow.DailyAction, PlayDaily), Leaderboard() } : new[] { Action(Flow.DailyAction, PlayDaily) } };
        }
        // The first Play today teaches the Daily before its board opens; read or skipped, the run starts.
        private void PlayDaily()
        {
            if (Flow.TodayRun != null || Flow.AttemptedToday || Lessons.Device.Taught(Lesson.RealmsDaily)) { Flow.PlayDaily(); return; }
            views.Teach(Lessons.RealmsDaily(Flow.HasLeaderboard), () => { Lessons.Device.Teach(Lesson.RealmsDaily); Flow.PlayDaily(); });
        }
        // Opens the platform's own leaderboard; drawn only for a signed-in player.
        private PageAction Leaderboard() => Action("Leaderboard", Flow.ShowLeaderboard);
        public ProfilePageView ProfilePage()
        {
            var state = Flow.Product.Read;
            var worn = ProfileEmblems.All.FirstOrDefault(emblem => emblem.Id != 0 && emblem.Id == state.WornEmblem);
            // The platform account names the player; signed out the panel says Player. Nothing is editable.
            return new ProfilePageView { Name = Flow.Account?.Name ?? SignedOutName, Avatar = Flow.Account?.Avatar, Realm = WornRealm, Emblem = worn?.Id ?? 0,
                Worn = worn == null ? null : "Wearing " + worn.Name + (worn.Realm != 0 ? "’s emblem" : ""),
                Stars = state.Stars.Sum(value => (int)value), Streak = state.Streak, BestDailyScore = state.BestDailyScore,
                Emblems = ProfileEmblems.All.Where(emblem => emblem.Id != 0).Select(emblem => {
                    byte id = emblem.Id;
                    return new ProfileChoiceView { Id = id, Realm = emblem.Realm, Name = emblem.Name,
                        Detail = state.WornEmblem == id ? "Worn" : null, Available = Flow.EmblemUnlocked(id), Select = () => Flow.Wear(id) };
                }).ToArray() };
        }
        public SettingsPageView SettingsPage()
        {
            var view = AppPreferences.Read(Refresh, board);
            view.Identity = new[] { PanelBlock.Button(Action("Restore purchases", () => _ = Flow.RefreshBilling(), !Flow.Billing.Busy), false, icon: SkinSlots.IconRetry) };
            return view;
        }
        public ResultPageView ResultPage()
        {
            if (Flow.Campaign.Last != null) return Flow.Campaign.ResultPage(Application.productName, Flow.Account?.Name);
            var attempt = Flow.Product.Read.DailyAttempt;
            var pair = attempt == null ? null : NativeEngine.Daily(attempt.DayId);
            var result = new ResultPageView { ProductName = Application.productName, Mode = "Daily", PlayerName = Flow.Account?.Name,
                HasResult = attempt != null, Realm = pair?.Realm ?? 1, Day = attempt?.DayId ?? 0,
                ObjectiveKind = pair?.Kind ?? 0, ObjectiveValue = pair?.Value ?? 0,
                Score = attempt?.DailyScore ?? 0,
                ObjectiveTotal = attempt?.ObjectiveTotal ?? 0,
                Streak = Flow.Product.Read.Streak,
                Tier = attempt != null && attempt.Finished ? attempt.Tier : (byte?)null,
                NextOpensAt = attempt != null && attempt.DayId == Flow.Today.DayId ? Flow.Today.FreezesAt : 0, Now = Flow.Runs.Now,
                Notice = attempt != null && !attempt.Finished ? "Attempt used. This run is no longer open in this app session." : null,
                Share = ResultSharing.Open, Leaderboard = Flow.HasLeaderboard ? Leaderboard() : null,
                Done = Action("Continue", () => Flow.Show(StorePage.Home)) };
            // The saved best already holds this run's score.
            result.DailyOutcome(attempt != null && attempt.DailyScore >= Flow.Product.Read.BestDailyScore);
            return result;
        }
        public bool CanNavigate(AppPage page) => Flow != null && Flow.Page != StorePage.Board;
        public void Navigate(AppPage page) => Flow.Show((StorePage)Enum.Parse(typeof(StorePage), page.ToString()));
        public void Report(Exception error) => Flow.Report(error);
        // A Campaign run and the Daily play on the one run board; each leaves to its own page.
        private void OpenBoard(LocalBoardActionProvider provider)
        {
            if (provider.Daily)
                runBoard.Open(provider.Bind(new DailyContext { Top = Flow.DailyTop(), Best = Flow.Product.Read.BestDailyScore,
                    ClosesAt = Flow.Today.FreezesAt, Now = Flow.Runs.Now }),
                    () => Flow.Unsaved, _ => Flow.LeaveDaily(), Flow.LeaveDaily);
            else runBoard.Open(provider.Bind(), () => Flow.Unsaved, Flow.Campaign.Finished, Flow.Campaign.Left, Flow.Campaign.FirstRun);
            // The page that opened the board stays until the board has drawn,
            // and is not shown again on the way back.
            views.HandOver(board);
        }
        private void OnApplicationPause(bool paused) { if (!paused && Flow != null) { Refresh(); _ = Flow.RefreshBilling(); } }
        private void RetirePage()
        {
            views.Retire(); shell.Backdrop(null);
        }
        private void OnDestroy()
        {
            if (Flow != null) { Flow.Changed -= Refresh; Flow.BoardOpened -= OpenBoard; Flow.Dispose(); Flow = null; }
            RetirePage(); shell.ReleaseArtwork();
        }
    }
}
