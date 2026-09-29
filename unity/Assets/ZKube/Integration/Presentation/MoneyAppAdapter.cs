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
        private float textScale;
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
        private bool walletFailure;
        private string shownKey;

        public void Initialize(MoneyAppFlow flow, ClientIdentity clientIdentity, Func<long> clock = null, float scale = 1, float? displayDensity = null)
        {
            if (initialized) throw new InvalidOperationException("Money overview is already initialized");
            Flow = flow ?? throw new ArgumentNullException(nameof(flow));
            identity = clientIdentity ?? throw new ArgumentNullException(nameof(clientIdentity));
            now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            injectedDensity = displayDensity; textScale = BoardController.SupportedTextScale(scale);
            catalog = PageCatalog.Load();
            shell = gameObject.AddComponent<PageShell>(); shell.Initialize(Application.productName);
            views = gameObject.AddComponent<PageViews>(); InitializeViews();
            initialized = true;
            observedDay = now() / 86400;
            _ = RefreshOverview();
        }
        private void InitializeViews() => views.Initialize(this, shell, "Arcade", "arena", textScale, Density);
        private float Density() => injectedDensity ?? BoardController.ReadDisplayDensity();

        public Task RefreshOverview() => Run(RefreshVisiblePage);
        private Task RefreshVisiblePage(long epoch, CancellationToken token) =>
            browsingProfile ? RefreshProfilePage(epoch, token) : browsingRewards ? RefreshRewardPage(epoch, token) : browsingKredits ? RefreshKreditPage(epoch, token) : browsingDaily ? RefreshDailyPage(epoch, token) : browsingSession ? RefreshSessionPage(epoch, token) :
            browsingCampaign ? RefreshCampaignPage(epoch, token) : sharedPage.HasValue ? RefreshSharedPage(epoch, token) : Refresh(epoch, token);
        // Connecting reads the owner (its last operation's receipt with it),
        // then opens the Arcade.
        public Task Connect() => Run(async (epoch, token) => {
            await Flow.Connect();
            if (!Current(epoch)) return;
            await RefreshOwner(epoch, token);
            if (!Current(epoch)) return;
            CloseProductViews(); browsingDaily = true;
            await RefreshDailyPage(epoch, token);
        });
        public Task CheckTransaction() => Run(async (epoch, token) => {
            var result = await Flow.ResumePending(token);
            if (!Current(epoch)) return;
            ShowReceipt(result.Value, identity.Owner);
            await RefreshVisiblePage(epoch, token); // A receipt survives an empty post-confirmation journal.
        });
        public async Task Disconnect()
        {
            if (detached || !isActiveAndEnabled || Flow == null || paused) return;
            if (PlayingRun) boardHost.Board.SetHostInputEnabled(false);
            // Disconnect is available even during a wallet/read callback.
            CloseProductViews(); RetireRead(); ownerRead = null; ForgetReceipt(); failure = null;
            Busy = true; Status = "Disconnected"; Present(); long epoch = generation;
            try { await Flow.Disconnect(); if (Current(epoch)) Status = "Disconnected"; }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Present(); } }
        }
        private async Task RunCampaign(Func<long, CancellationToken, Task> operation)
        {
            if (detached || !isActiveAndEnabled || paused || Flow == null || PlayingRun || identity.Owner == null) return;
            long epoch = generation;
            try { await operation(epoch, CancellationToken.None); }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) Present(); }
        }

        private async Task Run(Func<long, CancellationToken, Task> operation)
        {
            if (detached || !isActiveAndEnabled || paused || Flow == null || Busy || PlayingRun) return;
            RetireRead(); reads = new CancellationTokenSource(); long epoch = generation;
            Busy = true; failure = null; walletFailure = false; info = null; Present();
            try { await operation(epoch, reads.Token); }
            catch (OperationCanceledException) { if (Current(epoch)) Fail("Refresh was cancelled. Refresh to try again."); }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Present(); } }
        }
        // Without an owner the Arcade's public Daily is read for the connect page;
        // with one and no page open, the Arcade opens.
        private async Task Refresh(long epoch, CancellationToken token)
        {
            if (identity.Owner != null) { CloseProductViews(); browsingDaily = true; await RefreshDailyPage(epoch, token); return; }
            var publication = await Flow.RefreshPublic(token);
            if (!Current(epoch)) return;
            var value = publication.Value; publicRead = publication;
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
            "missing-config" => "Daily service unavailable", "missing-daily" => "Today's Daily is not available",
            "suspended" => "Daily is suspended", "paused" => "Daily play is paused", "not-open" => "Opens later today",
            "funding" => "Daily is being prepared", "open" => "Daily is open", "frozen" => "Entries are closed",
            "finalized" => "Daily complete", _ => "Daily status unavailable"
        };
        private static string SessionText(SessionAssessment value)
        {
            if (value == null) return "Device session not checked yet";
            if (value.Status == "none") return "Device session not set up";
            if (!value.Current) return value.TokenMayClose ? "Device session expired" : "Device session needs renewal";
            if (value.Funding != "ready") return "Device session needs a fee refill";
            return value.Status == "expiring" ? "Device session expires soon" : "Device session ready";
        }
        private void ShowReceipt(ExecutionResult result, string address)
        {
            if (result.Code == "no-pending-transaction")
            {
                // This observation is not a transaction receipt. Preserve an
                // actual receipt, but acknowledge an empty check when none exists.
                if (LastReceipt == null) { receiptNotice = "There is no transaction waiting to be checked."; receiptFamily = Family(); }
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
        private void ShowError(Exception error)
        {
            walletFailure = error is WalletRequestException;
            Fail(error is MoneyConfigurationException ? "Network configuration is unavailable." :
                error is WalletRequestException wallet ? wallet.Code == "wallet-busy" ? "A wallet request is already open." :
                    wallet.Code == "account-changed" ? "The wallet account changed. Connect again." : "The wallet request was not completed." :
                "Could not refresh. Try again.");
        }
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
            if (PlayingRun) return;
            if (Flow == null || paused) return;
            if (ownerRead != null && !ownerRead.IsCurrent) { ownerRead = null; Present(); }
            if (receiptOwner != null && !identity.IsCurrent(receiptLease)) { ForgetReceipt(); Present(); }
            RefreshCampaignIdentity(); RefreshSessionIdentity(); RefreshDailyIdentity(); RefreshKreditIdentity(); RefreshRewardIdentity(); RefreshProfileIdentity();
            if (dirty && !presenting && shell.Root.activeSelf) StartCoroutine(Render());
            if (Busy || browsingCampaign || browsingSession || browsingDaily || browsingKredits || browsingRewards || browsingProfile || browsingOperation ||
                sharedPage.HasValue) return;
            long timestamp = now(), day = timestamp / 86400;
            long? freeze = publicRead != null && publicRead.IsCurrent ? publicRead.Value.FreezesAt : null;
            if (day != observedDay || (freeze.HasValue && timestamp >= freeze.Value && freezeAttempt != freeze.Value))
            { observedDay = day; if (freeze.HasValue && timestamp >= freeze.Value) freezeAttempt = freeze.Value; _ = RefreshOverview(); }
        }

        // A new page, or the same page in another realm, sends the drawn page
        // leaving while the next one loads its art and draws.
        private IEnumerator Render()
        {
            presenting = true; dirty = false;
            string key = PageKey(); byte realm = PageRealm();
            bool load = !shell.RealmReady(realm);
            if (load || key != shownKey)
                shell.Depart(AppPreferences.ReducedMotion, Mathf.Max(.5f, Density()), load);
            if (load)
            {
                shell.RequestRealm(realm);
                while (shell.Loading) yield return null;
                if (shell.ArtworkError != null)
                {
                    presenting = false; shownKey = null;
                    views.Unavailable("This page could not be opened.", "Realm artwork unavailable. Refresh to try again.",
                        PageAction("Try again", () => { shell.ReleaseArtwork(); _ = RefreshOverview(); }));
                    yield break;
                }
            }
            presenting = false;
            if (dirty || PageKey() != key || PageRealm() != realm) yield break;
            try { Draw(); shownKey = key; }
            catch (Exception error)
            {
                Debug.LogException(error); shownKey = null;
                views.Unavailable("This page could not be opened.", error.Message, PageAction("Try again", () => _ = RefreshOverview()));
            }
        }

        private void OnApplicationPause(bool value)
        {
            if (detached || paused == value) return;
            paused = value;
            if (PlayingRun) { boardHost.Suspend(value); return; }
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
            if (PlayingRun) boardHost.Close();
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
        // Nothing an earlier identity or read drew survives a hidden page.
        private void HidePages()
        {
            StopAllCoroutines(); presenting = false; dirty = false; shownKey = null;
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
            if (detached) return; detached = true; RetireRead();
            if (PlayingRun) boardHost.Close();
            publicRead = null; ownerRead = null; ClearProductObservations();
            if (shell != null) { HidePages(); RetireArtwork(); }
        }
        private void OnDestroy() => Detach();
        private void CloseProductViews()
        {
            CloseSharedView(); CloseSessionView(); CloseCampaignView(); CloseDailyView(); CloseKreditView(); CloseRewardView(); CloseProfileView();
            browsingOperation = false; Present();
        }
        private void ClearProductObservations()
        {
            settingsRead = null;
            ClearCampaignObservation(); ClearSessionObservation(); ClearDailyObservation(); ClearKreditObservation(); ClearRewardObservation(); ClearProfileObservation();
        }
        private void RetireArtwork() => shell.ReleaseArtwork();

        private static string Sol(ulong lamports) => MoneyText.Sol(lamports);
        private static string Short(string address) => address == null || address.Length <= 10 ? address :
            address.Substring(0, 4) + "…" + address.Substring(address.Length - 4);
        private static string Day(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400).UtcDateTime
            .ToString("dd MMM yyyy", CultureInfo.InvariantCulture);
        private static string Utc(long seconds) => seconds > DateTimeOffset.MaxValue.ToUnixTimeSeconds() ? "a date outside the calendar" :
            DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime.ToString("d MMM · HH:mm", CultureInfo.InvariantCulture) + " UTC";
        private uint Today => checked((uint)(now() / 86400));
        private byte TodayRealm => dailyRead != null && dailyRead.IsCurrent ? dailyRead.Value.Lobby.Realm :
            publicRead != null && publicRead.IsCurrent ? publicRead.Value.Realm : NativeEngine.Daily(Today).Realm;
    }
}
