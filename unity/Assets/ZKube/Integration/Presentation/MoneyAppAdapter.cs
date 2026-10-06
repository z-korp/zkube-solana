using ZKube.Core.Generated;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Integration.Transport;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    // Money pages coordinate explicit operations; accepted launches bind the shared board host.
    // Every page draws on the Lumen page shell: the shared pages through
    // IAppPageSource, the Arena's own pages as panel pages.
    public sealed partial class MoneyAppAdapter : MonoBehaviour, IAppPageSource
    {
        public MoneyAppFlow Flow { get; private set; }
        public bool Busy { get; private set; }
        public string Status { get; private set; }
        // A page is waiting to be drawn, or its art is loading.
        public bool Drawing => shell != null && shell.Root.activeSelf && !PlayingRun && (dirty || presenting || shell.Loading);
        public ExecutionResult LastReceipt => identity != null && identity.IsCurrent(receiptLease) ? lastReceipt : null;
        private ExecutionResult lastReceipt;
        private ClientIdentity identity;
        private Func<long> now;
        // The pages' text size is the saved setting itself; a test's explicit size
        // stands in for it and is never saved.
        private float? injectedScale;
        private float viewScale;
        private float TextScale => injectedScale ?? AppPreferences.TextScale;
        private float? injectedDensity;
        private bool fullReceipt;
        private string receiptNotice, receiptOwner, receiptFamily;
        private IdentityLease receiptLease;
        private PageShell shell;
        private PageViews views;
        private PageCatalog catalog;
        private CancellationTokenSource reads;
        private MoneyRead<PublicDaily> publicRead;
        private MoneyRead<MoneyOwnerState> ownerRead;
        private bool paused, detached, initialized, dirty, presenting;
        private long generation, observedDay, freezeAttempt = -1;
        // The player's words for the last failure, shown on the page it happened on.
        private string failure;
        private bool restored;
        private string shownKey;

        public void Initialize(MoneyAppFlow flow, ClientIdentity clientIdentity, Func<long> clock = null, float? scale = null, float? displayDensity = null)
        {
            if (initialized) throw new InvalidOperationException("Money overview is already initialized");
            Flow = flow ?? throw new ArgumentNullException(nameof(flow));
            Flow.ExecutionStep = step => { actionStep = step; Present(); };
            // Another language: this adapter's pages are built again from its words.
            Words.Changed += Present;
            identity = clientIdentity ?? throw new ArgumentNullException(nameof(clientIdentity));
            now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            injectedDensity = displayDensity; injectedScale = scale.HasValue ? BoardController.SupportedTextScale(scale.Value) : (float?)null;
            catalog = PageCatalog.Load();
            shell = gameObject.AddComponent<PageShell>(); shell.Initialize(Application.productName);
            views = gameObject.AddComponent<PageViews>(); InitializeViews();
            initialized = true;
            observedDay = Today;
            _ = RefreshOverview();
        }
        private void InitializeViews() { viewScale = TextScale; views.Initialize(this, shell, "Arena", "arena", viewScale, Density); }
        private float Density() => injectedDensity ?? BoardController.ReadDisplayDensity();

        public Task RefreshOverview() => Run(RefreshVisiblePage);
        private Task RefreshVisiblePage(long epoch, CancellationToken token) =>
            browsingProfile ? RefreshProfilePage(epoch, token) : browsingRewards ? RefreshRewardPage(epoch, token) : browsingKredits ? RefreshKreditPage(epoch, token) : browsingDaily ? RefreshDailyPage(epoch, token) : browsingSession ? RefreshSessionPage(epoch, token) :
            campaignPage != null ? RedrawCampaign() : sharedPage.HasValue ? RefreshSharedPage(epoch, token) : Refresh(epoch, token);
        // The Campaign reads its play record on this device: there is nothing to fetch.
        private Task RedrawCampaign() { Present(); return Task.CompletedTask; }
        // The wallet in front of the app pauses it, which retires this operation:
        // the address it brings back is then entered by the page's own rule (Update).
        public Task Connect() => Run(async (epoch, token) => {
            ClearRefusal();
            try { await Flow.Connect(); }
            catch (WalletRequestException error)
            { ClientLog.Outcome("connect", error.Code, null); if (Current(epoch)) Refuse("Connect", Reason(error), () => _ = Connect()); return; }
            if (Current(epoch)) await Enter(epoch, token);
        });
        // Entering with an address: its last operation (and that receipt), then the Arena.
        private async Task Enter(long epoch, CancellationToken token)
        {
            await RefreshOwner(epoch, token);
            if (!Current(epoch)) return;
            CloseProductViews(); browsingDaily = true;
            await RefreshDailyPage(epoch, token);
        }
        // The read the visible page waits on is absent, and no failure stands in its place.
        private bool ReadMissing() => failure == null && Family() switch {
            "Daily" => dailyRead == null, "Kredits" => kreditRead == null, "Rewards" => rewardRead == null,
            "Device" => sessionRead == null, "Profile" => profileRead == null, _ => false };
        // deauthorize is false when the wallet itself ended the authorization.
        public async Task Disconnect(bool deauthorize = true)
        {
            if (detached || !isActiveAndEnabled || Flow == null || paused) return;
            if (ArcadeRun) boardHost.Board.SetHostInputEnabled(false);
            runBoard?.Close(); campaign = null;
            // Disconnect is available even during a wallet/read callback.
            CloseProductViews(); RetireRead(); ownerRead = null; ForgetReceipt(); failure = null;
            Busy = true; Status = "Disconnected"; Present(); long epoch = generation;
            try { await Flow.Disconnect(deauthorize); if (Current(epoch)) Status = "Disconnected"; }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Present(); } }
        }
        // leaving: the player is going to another page. That never waits: it
        // retires whatever read or wait this page was running. An action's own
        // request goes on, and its outcome reaches the player as it does after
        // the wallet's pause.
        private async Task Run(Func<long, CancellationToken, Task> operation, bool leaving = false)
        {
            if (detached || !isActiveAndEnabled || paused || Flow == null || PlayingRun || Busy && !leaving) return;
            RetireRead(); reads = new CancellationTokenSource(); long epoch = generation;
            Busy = true; failure = null; info = null; Present();
            try { await operation(epoch, reads.Token); }
            catch (OperationCanceledException) { if (Current(epoch)) Fail(Words.ArenaRefreshCancelled); }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Present(); } }
        }
        // Without an owner the Arcade's public Daily is read for the connect page;
        // with one and no page open, the Arcade opens.
        private async Task Refresh(long epoch, CancellationToken token)
        {
            // A start with a saved authorization enters with its address, asking no wallet; tried once.
            if (identity.Owner == null && !restored) { restored = true; await Flow.Restore(); if (!Current(epoch)) return; }
            if (identity.Owner != null) { await Enter(epoch, token); return; }
            var publication = await Flow.RefreshPublic(token);
            if (!Current(epoch)) return;
            var value = publication.Value; publicRead = publication; AwaitLaunch(value.Launched);
            if (value.FreezesAt.HasValue && value.ObservedAt >= value.FreezesAt.Value) freezeAttempt = value.FreezesAt.Value;
            Status = "Daily updated"; Present();
        }
        // The settings page shows this device's session from the owner read.
        private async Task RefreshOwner(long epoch, CancellationToken token)
        {
            var privateRead = await Flow.RefreshOwner(token);
            if (!Current(epoch)) return;
            ownerRead = privateRead;
            if (privateRead.Value.PreviousOperation != null) ShowReceipt(privateRead.Value.PreviousOperation, privateRead.Value.Owner);
            Present();
        }
        private static string PublicStatus(string value) => value switch {
            "missing-config" or "missing-daily" => Words.ArenaStatusOpensSoon,
            "suspended" => Words.ArenaStatusSuspended, "paused" => Words.ArenaStatusPaused, "not-open" => Words.ArenaStatusNotOpen,
            "open" => Words.ArenaStatusOpen, "frozen" => Words.ArenaStatusFrozen,
            "finalized" => Words.ArenaStatusFinalized, _ => Words.ArenaStatusUnknown
        };
        private static string SessionText(SessionAssessment value)
        {
            if (value == null) return "Device session not checked yet";
            if (value.Status == "none") return "Device session not set up";
            if (!value.Current) return value.TokenMayClose ? "Device session expired" : "Device session needs renewal";
            if (value.Funding != "ready") return "Device deposit needs a top-up";
            return value.Status == "expiring" ? "Device session expires soon" : "Device session ready";
        }
        private void ShowReceipt(ExecutionResult result, string address)
        {
            if (result.Code == "no-pending-transaction")
            {
                // This observation is not a transaction receipt. Preserve an
                // actual receipt, but acknowledge an empty check when none exists.
                if (LastReceipt == null) { receiptNotice = Words.ArenaReceiptNoneWaiting; receiptFamily = Family(); }
                return;
            }
            if (lastReceipt?.Signature != result.Signature) fullReceipt = false;
            receiptOwner = address; receiptLease = identity.Lease(); lastReceipt = result; receiptNotice = null; receiptFamily = Family();
            Present();
        }
        private void ForgetReceipt() { lastReceipt = null; receiptOwner = null; receiptLease = null; receiptNotice = null; receiptFamily = null; fullReceipt = false; }
        private void ToggleReceiptDetails()
        {
            if (Busy || detached || paused || !isActiveAndEnabled || string.IsNullOrEmpty(LastReceipt?.Signature)) return;
            fullReceipt = !fullReceipt; Present();
        }
        // A read that failed: one log line, and on the page what failed in plain words.
        private void ShowError(Exception error) { ClientLog.Failure("read " + Family(), error); Fail(Reason(error)); }
        private void Fail(string message) { failure = message; Status = message; Present(); }
        // What the player should know about the last operation, shown on its page.
        private void Inform(string message) { info = message; Status = message; Present(); }
        private string info;
        private bool Current(long epoch) => this != null && isActiveAndEnabled && !detached && !paused && epoch == generation;
        // Redraws the visible page once this frame's changes are in.
        private void Present() => dirty = true;

        private void Update()
        {
            if (!initialized || detached) return;
            RefreshCampaignIdentity();
            if (PlayingRun) return;
            if (Flow == null || paused) return;
            // A board's pause may have changed the text size: the pages follow the setting.
            if (viewScale != TextScale) { InitializeViews(); Present(); }
            if (ownerRead != null && !ownerRead.IsCurrent) { ownerRead = null; Present(); }
            if (receiptOwner != null && !identity.IsCurrent(receiptLease)) { ForgetReceipt(); Present(); }
            RefreshSessionIdentity(); RefreshDailyIdentity(); RefreshKreditIdentity(); RefreshRewardIdentity(); RefreshProfileIdentity();
            if (!Busy && now() >= launchRecheckAt) { launchRecheckAt = long.MaxValue; _ = RefreshOverview(); }
            // No page waits on a read nobody is making. Whatever retired the operation
            // that would have read it (the wallet in front of the app, a pause, a
            // superseded request), the visible page starts its own read.
            if (!Busy && identity.Owner != null && ReadMissing()) _ = RefreshOverview();
            // A transaction still unconfirmed on the page in front of the player is followed without a tap.
            if (!Busy && identity.Owner != null && refusal == null && failure == null && PendingShown() && Time.unscaledTime >= followAgainAt) _ = FollowTransaction();
            if (dirty && !presenting && shell.Root.activeSelf) StartCoroutine(Render());
            if (Busy || campaignPage != null || browsingSession || browsingDaily || browsingKredits || browsingRewards || browsingProfile || browsingOperation ||
                sharedPage.HasValue) return;
            long timestamp = now(), day = Today;
            long? freeze = publicRead != null && publicRead.IsCurrent ? publicRead.Value.FreezesAt : null;
            if (day != observedDay || (freeze.HasValue && timestamp >= freeze.Value && freezeAttempt != freeze.Value))
            { observedDay = day; if (freeze.HasValue && timestamp >= freeze.Value) freezeAttempt = freeze.Value; _ = RefreshOverview(); }
        }

        // A new page, or the same page in another realm: the drawn page stays
        // whole while the next one's art loads, then leaves as the next is drawn.
        private IEnumerator Render()
        {
            presenting = true; dirty = false;
            string key = PageKey(); byte realm = PageRealm();
            bool load = !shell.RealmReady(realm);
            if (load)
            {
                shell.RequestRealm(realm);
                while (shell.Loading) yield return null;
                if (shell.ArtworkError != null)
                {
                    presenting = false; shownKey = null;
                    views.Unavailable(Words.PageUnavailable, Words.ArenaArtUnavailable,
                        PageAction(Words.ActionTryAgain, () => { shell.ReleaseArtwork(); _ = RefreshOverview(); }, name: "Try again"));
                    yield break;
                }
            }
            presenting = false;
            if (dirty || PageKey() != key || PageRealm() != realm) yield break;
            if (load || key != shownKey) shell.Depart(AppPreferences.ReducedMotion, Mathf.Max(.5f, Density()));
            try
            {
                Draw(); shownKey = key;
                // The page that shows a settled transaction, read back: the end of its timing.
                if (!Busy && !ReadMissing() && lastReceipt?.Signature != null) ClientLog.Shown(lastReceipt.Signature);
            }
            // A read went stale between this frame's check and its draw, invalidated
            // from another thread: the next frame draws what replaced it.
            catch (OperationCanceledException) { Present(); }
            catch (Exception error)
            {
                Debug.LogException(error); shownKey = null;
                views.Unavailable(Words.PageUnavailable, null, PageAction(Words.ActionTryAgain, () => _ = RefreshOverview()));
            }
        }

        private void OnApplicationPause(bool value)
        {
            if (detached || paused == value) return;
            paused = value;
            if (ArcadeRun) { boardHost.Suspend(value); return; }
            // The run board pauses itself.
            if (PlayingRun) return;
            if (value)
            {
                RetireRead(); Busy = false; publicRead = null; ownerRead = null;
                ClearProductObservations(); HidePages();
            }
            else if (isActiveAndEnabled)
            { shell.Show(true); if (Flow != null) _ = RefreshOverview(); }
        }
        private void OnDisable()
        {
            if (!initialized || detached) return;
            boardHost?.Close();
            runBoard?.Close();
            RetireRead(); Busy = false; ownerRead = null; publicRead = null;
            ClearProductObservations(); HidePages();
            RetireArtwork();
        }
        private void OnEnable()
        {
            if (!initialized || detached || paused) return;
            shell.Show(true);
            if (Flow != null) _ = RefreshOverview();
        }
        // Nothing an earlier identity or read drew survives a hidden page. A
        // board taking the screen gets the page's painting until it has drawn.
        private void HidePages(BoardController coveredBy = null)
        {
            StopAllCoroutines(); presenting = false; dirty = false; shownKey = null;
            if (coveredBy != null) { views.HandOver(coveredBy); return; }
            views.Hide(); shell.Show(false);
        }
        private void RetireRead()
        {
            generation++; var old = reads; reads = null;
            try { old?.Cancel(); }
            catch (Exception error) { Debug.LogException(error); }
            finally { old?.Dispose(); }
        }
        public void Detach()
        {
            if (detached) return; detached = true; RetireRead(); Words.Changed -= Present;
            boardHost?.Close();
            runBoard?.Close();
            publicRead = null; ownerRead = null; ClearProductObservations();
            if (shell != null) { HidePages(); RetireArtwork(); }
        }
        private void OnDestroy() => Detach();
        private void CloseProductViews()
        {
            CloseSharedView(); CloseSessionView(); CloseCampaignView(); CloseDailyView(); CloseKreditView(); CloseRewardView(); CloseProfileView();
            browsingOperation = false; launchRecheckAt = long.MaxValue; ClearRefusal(); Present();
        }
        private void ClearProductObservations()
        {
            settingsRead = null;
            ClearSessionObservation(); ClearDailyObservation(); ClearKreditObservation(); ClearRewardObservation(); ClearProfileObservation();
        }
        private void RetireArtwork() => shell.ReleaseArtwork();

        private static string Sol(ulong lamports) => MoneyText.Sol(lamports);
        private static string Short(string address) => address == null || address.Length <= 10 ? address :
            address.Substring(0, 4) + "…" + address.Substring(address.Length - 4);
        private static string Day(uint day) => Words.DateWithYear(DateTimeOffset.FromUnixTimeSeconds((long)day * 86400).UtcDateTime);
        private static string Utc(long seconds) => seconds > DateTimeOffset.MaxValue.ToUnixTimeSeconds() ? Words.ArenaDateOutside :
            Words.FormatDateTime(Words.Date(DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime),
                DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime.ToString("HH:mm", CultureInfo.InvariantCulture));
        private uint Today => NativeEngine.DayAt(now());
        private byte TodayRealm => dailyRead != null && dailyRead.TryValue(out var daily) ? daily.Lobby.Realm :
            publicRead != null && publicRead.TryValue(out var today) ? today.Realm : NativeEngine.Daily(Today).Realm;
    }
}
