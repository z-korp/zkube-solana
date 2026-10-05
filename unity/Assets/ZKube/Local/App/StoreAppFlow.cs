using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Local.Billing;

namespace ZKube.Local.App
{
    public enum StorePage { Home, Campaign, Level, Profile, Settings, Board, Result }

    // The concrete store page flow. The Campaign is the shared journey over the
    // local record, with the store purchase policy as its gate.
    public sealed class StoreAppFlow : IDisposable
    {
        public readonly LocalProductStore Product;
        public readonly StoreRunClient Runs;
        public readonly CampaignBilling Billing;
        private readonly ZKube.Presentation.IPlayerAccounts accounts;
        // The platform's signed-in player, or null: the profile shows its name
        // and avatar, and nothing else depends on it.
        public ZKube.Presentation.PlayerAccount Account { get; private set; }
        private readonly Dictionary<string, LocalBoardActionProvider> providers = new Dictionary<string, LocalBoardActionProvider>();
        public readonly CampaignJourney Campaign;
        private CancellationTokenSource pageWait = new CancellationTokenSource();
        private long generation;
        private bool disposed;
        public StorePage Page { get; private set; }
        // The Daily's run while it plays.
        public LocalBoardActionProvider Provider { get; private set; }
        public string Error { get; private set; }
        public string BillingNotice { get; private set; }
        // The last store query failed; it stays set until one succeeds.
        public bool StoreUnavailable { get; private set; }
        private bool unsaved;
        public bool Unsaved => unsaved || Campaign.Unsaved;
        public event Action Changed;
        public event Action<LocalBoardActionProvider> BoardOpened;
        public StoreAppFlow(LocalProductStore product, StoreRunClient runs, CampaignBilling billing, ZKube.Presentation.IPlayerAccounts accounts = null)
        {
            this.accounts = accounts ?? new ZKube.Presentation.NoPlayerAccounts();
            Product = product ?? throw new ArgumentNullException(nameof(product));
            Runs = runs ?? throw new ArgumentNullException(nameof(runs));
            Billing = billing ?? throw new ArgumentNullException(nameof(billing));
            Page = StorePage.Home;
            Billing.Settled += StoreSettled;
            Campaign = new CampaignJourney(product, runs, page => Go((StorePage)Enum.Parse(typeof(StorePage), page.ToString())),
                provider => { Go(StorePage.Board); BoardOpened?.Invoke(provider); });
        }
        public LocalDaily Today => Runs.Today();
        public LocalRunView TodayRun => Product.Read.DailyAttempt?.DayId == Today.DayId ? Runs.Active("daily") : null;
        public bool AttemptedToday => Product.Read.DailyAttempt?.DayId == Today.DayId;
        public string DailyAction => TodayRun != null ? "Resume run" : AttemptedToday ? "View result" : "Play today";
        private CampaignProgressSummary Progress() => NativeEngine.CampaignProgress(Product.Read.Stars);
        // The Campaign tab opens the journey's map.
        public void Show(StorePage page)
        {
            Check();
            if (page == StorePage.Board || page == StorePage.Level || page == StorePage.Result) throw new ArgumentException("Use the bound page action");
            if (page == StorePage.Campaign) Campaign.Map(); else Navigate(page);
        }
        // Asks the platform who is playing. Play never waits for it, and a
        // refusal or a failure leaves the profile without a name.
        public async Task SignIn()
        {
            Check();
            ZKube.Presentation.PlayerAccount account = null;
            try { account = await accounts.SignIn(); }
            catch (Exception) { }
            if (disposed) return;
            Account = account; Changed?.Invoke();
        }
        // The platform's Daily leaderboard, for a signed-in player: each finished
        // Daily's score goes to it, and its own screen shows it. Signed out
        // there is neither, and nothing else changes.
        public bool HasLeaderboard => Account != null && accounts.HasDailyLeaderboard;
        // A tap that is still opening it; the button shows that, and a second tap waits.
        public bool LeaderboardOpening { get; private set; }
        public const string LeaderboardUnavailable = "The leaderboard did not open. Tap Leaderboard to try again.";
        // The tap's outcome is the platform's screen or one reason on the page that asked.
        public async Task ShowLeaderboard()
        {
            Check();
            if (!HasLeaderboard || LeaderboardOpening) return;
            long request = generation; bool opened = false;
            LeaderboardOpening = true; Error = null; Changed?.Invoke();
            try { opened = await accounts.ShowDailyLeaderboard(); }
            catch (Exception) { }
            if (disposed) return;
            LeaderboardOpening = false;
            if (!opened && Current(request)) Error = LeaderboardUnavailable;
            Changed?.Invoke();
        }
        // Today's top on that leaderboard, read once as a Daily run opens; signed out there is none.
        public Task<ulong?> DailyTop() => HasLeaderboard ? accounts.DailyTop() : Task.FromResult<ulong?>(null);
        public void PlayDaily()
        {
            Check();
            if (TodayRun != null) { Open(TodayRun); return; }
            if (AttemptedToday) { Navigate(StorePage.Result); return; }
            try { Open(Runs.StartDaily()); }
            catch (Exception error)
            {
                // Reservation can fail after native acceptance and the active
                // slot exists. Keep exactly that run, never offer a second start.
                if (TodayRun == null) throw;
                unsaved = true; Open(TodayRun, error);
            }
        }
        public bool EmblemUnlocked(byte emblem) => emblem >= 1 && emblem <= ZKube.Presentation.ProfileEmblems.Last && Progress().EmblemUnlocked[emblem] != 0;
        public void Wear(byte emblem)
        {
            Check();
            if (!EmblemUnlocked(emblem)) throw new InvalidOperationException("Earn this emblem first");
            Write(state => state.WornEmblem = emblem); Changed?.Invoke();
        }
        // The Daily's run left the board: its result page, its score to the
        // platform leaderboard once finished.
        public void LeaveDaily()
        {
            Check(); ObservePersistence();
            var attempt = Product.Read.DailyAttempt;
            if (attempt != null && attempt.Finished && HasLeaderboard) accounts.SubmitDailyScore(attempt.DailyScore);
            Navigate(StorePage.Result);
        }
        // A run's board was left for Home: the run stays saved, and Home or the map resumes it.
        public void LeaveHome() { Check(); ObservePersistence(); Navigate(StorePage.Home); }
        public void ObservePersistence()
        {
            if (Provider?.PersistenceFailure != null) unsaved = true;
        }
        public async Task RefreshBilling(bool purchase = false)
        {
            Check();
            if (Billing.Busy) return;
            long request = generation; var cancellation = pageWait.Token;
            Error = null; BillingNotice = null;
            try
            {
                // The request shows on its own button from here to its outcome.
                var asked = purchase ? Billing.Purchase(cancellation) : Billing.Query(cancellation);
                Changed?.Invoke();
                var answer = await asked;
                if (!Current(request)) return;
                StoreUnavailable = false;
                BillingNotice = answer.Status == CampaignBillingStatus.PaymentPending ? "Payment is pending. Campaign unlocks after payment completes."
                    : answer.Status == CampaignBillingStatus.ConfirmationPending ? "Campaign unlocked. Store confirmation is pending; restore purchases to check again."
                    : answer.Owned ? "Full Campaign unlocked" : null;
            }
            catch (OperationCanceledException) { if (Current(request)) BillingNotice = "Purchase cancelled"; }
            // A store failure is a billing notice: it shows where purchase and
            // restore are, never on the Home the app opens on.
            catch (Exception error) { if (Current(request)) { BillingNotice = error.Message; StoreUnavailable = true; } }
            finally { if (Current(request)) Changed?.Invoke(); }
        }
        // A request the page stopped waiting for still holds the store; its buttons come back when it lets go.
        private void StoreSettled() { if (!disposed) Changed?.Invoke(); }
        public void Report(Exception error) { if (!disposed) { Error = error.Message; Changed?.Invoke(); } }
        private void Open(LocalRunUpdate update)
        { var provider = new LocalBoardActionProvider(Runs, update); providers[update.View.RunId] = provider; Open(provider); }
        private void Open(LocalRunView view, Exception unsaved = null)
        {
            if (!providers.TryGetValue(view.RunId, out var provider))
            { provider = new LocalBoardActionProvider(Runs, view, unsaved); providers[view.RunId] = provider; }
            Open(provider);
        }
        private void Open(LocalBoardActionProvider provider)
        { Provider = provider; Navigate(StorePage.Board); BoardOpened?.Invoke(provider); }
        private void Write(Action<LocalProductState> change)
        {
            var before = Product.Read;
            try { Product.Write(current => { var next = LocalProductCodec.Decode(LocalProductCodec.Encode(current)); change(next); return next; }); }
            catch { if (!ReferenceEquals(before, Product.Read)) unsaved = true; throw; }
        }
        // A Campaign result belongs to the journey's own page; any other page lets
        // it go, so the next result page (today's Daily from View result) shows
        // its own result.
        private void Navigate(StorePage page) { Campaign.Forget(); Go(page); }
        private void Go(StorePage page)
        {
            Check();
            generation++; var old = pageWait; pageWait = new CancellationTokenSource();
            Page = page; Error = null; BillingNotice = null; old.Cancel(); old.Dispose(); Changed?.Invoke();
        }
        private bool Current(long value) => !disposed && value == generation;
        private void Check() { if (disposed) throw new ObjectDisposedException(nameof(StoreAppFlow)); }
        public void Dispose()
        { if (disposed) return; disposed = true; Billing.Settled -= StoreSettled; generation++; pageWait.Cancel(); pageWait.Dispose(); }
    }
}
