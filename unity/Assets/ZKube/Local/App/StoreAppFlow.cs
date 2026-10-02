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

    // How a Campaign run ended, kept for its result page.
    public sealed class CampaignOutcome
    {
        public byte Realm, Level, StarSources, EndReason, PreviousStars;
        public ulong Score;
        public uint MovesLeft, PrimaryProgress;
        public ZKube.Presentation.CampaignGoals Goals;
        public int Stars => (StarSources & 1) + (StarSources >> 1 & 1) + (StarSources >> 2 & 1);
    }

    // The concrete store page flow. Campaign recovery uses the same durable
    // local record as the money identity, with the store purchase policy.
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
        private CancellationTokenSource pageWait = new CancellationTokenSource();
        private long generation;
        private bool disposed;
        public StorePage Page { get; private set; }
        public byte Realm { get; private set; } = 1;
        public byte Level { get; private set; } = 1;
        public LocalBoardActionProvider Provider { get; private set; }
        public string Error { get; private set; }
        public string BillingNotice { get; private set; }
        // The last store query failed; it stays set until one succeeds.
        public bool StoreUnavailable { get; private set; }
        // Set when the result page shows a Campaign run; null for the Daily result.
        public CampaignOutcome LastCampaign { get; private set; }
        private byte startingStars;
        public bool Unsaved { get; private set; }
        public event Action Changed;
        public event Action<LocalBoardActionProvider> BoardOpened;
        public StoreAppFlow(LocalProductStore product, StoreRunClient runs, CampaignBilling billing, ZKube.Presentation.IPlayerAccounts accounts = null)
        {
            this.accounts = accounts ?? new ZKube.Presentation.NoPlayerAccounts();
            Product = product ?? throw new ArgumentNullException(nameof(product));
            Runs = runs ?? throw new ArgumentNullException(nameof(runs));
            Billing = billing ?? throw new ArgumentNullException(nameof(billing));
            Page = StorePage.Home; Realm = FurthestRealm;
        }
        public LocalDaily Today => Runs.Today();
        public LocalRunView TodayRun => Product.Read.DailyAttempt?.DayId == Today.DayId ? Runs.Active("daily") : null;
        public bool AttemptedToday => Product.Read.DailyAttempt?.DayId == Today.DayId;
        public string DailyAction => TodayRun != null ? "Resume run" : AttemptedToday ? "View result" : "Play today";
        public bool Cleared(byte realm) => Progress().Cleared[realm - 1] != 0;
        private CampaignProgressSummary Progress() => NativeEngine.CampaignProgress(Product.Read.Stars);
        // The furthest realm the core progression opens; the store purchase policy
        // is shown on that realm's page rather than skipping it.
        public byte FurthestRealm
        {
            get
            {
                var open = Progress().RealmUnlocked;
                for (int realm = open.Length; realm > 1; realm--) if (open[realm - 1] != 0) return (byte)realm;
                return 1;
            }
        }
        public byte LevelStars(byte realm, byte level) => Product.Read.Stars[(realm - 1) * Protocol.CampaignTargets.Length + level - 1];
        public int Stars(byte realm) => Product.Read.Stars.Skip((realm - 1) * Protocol.CampaignTargets.Length).Take(Protocol.CampaignTargets.Length).Sum(value => (int)value);
        public bool LevelAvailable(byte realm, byte level)
        {
            if (realm < 1 || realm > Protocol.Realms.Length || level < 1 || level > Protocol.CampaignTargets.Length) return false;
            var active = Runs.Active("campaign");
            if (active?.Realm == realm && active.Level == level) return true;
            return !StoreCampaignPolicy.PurchaseGate(Product)(realm) &&
                Progress().LevelUnlocked[(realm - 1) * Protocol.CampaignTargets.Length + level - 1] != 0;
        }
        public void Show(StorePage page)
        {
            Check();
            if (page == StorePage.Board || page == StorePage.Level || page == StorePage.Result) throw new ArgumentException("Use the bound page action");
            Navigate(page);
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
        public void ShowLeaderboard() { Check(); if (HasLeaderboard) accounts.ShowDailyLeaderboard(); }
        public void SelectRealm(byte realm)
        {
            Check();
            if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
            Realm = realm; Navigate(StorePage.Campaign);
        }
        public void Preview(byte level) => Preview(Realm, level);
        // A level's preview in any realm, as Home's Campaign card opens it.
        public void Preview(byte realm, byte level)
        {
            Check();
            if (!LevelAvailable(realm, level)) throw new InvalidOperationException("Clear the preceding trial first");
            Realm = realm; Level = level; Navigate(StorePage.Level);
        }
        public void PlayCampaign()
        {
            Check();
            var current = Runs.Active("campaign");
            if (current != null)
            {
                if (current.Realm != Realm || current.Level != Level)
                    throw new InvalidOperationException($"Run in progress in realm {current.Realm}, level {current.Level}");
                startingStars = LevelStars(Realm, Level); Open(current); return;
            }
            if (!LevelAvailable(Realm, Level)) throw new InvalidOperationException("This trial is locked");
            startingStars = LevelStars(Realm, Level);
            Open(Runs.StartCampaign(Realm, Level));
        }
        public void Retry()
        {
            Check();
            var last = LastCampaign ?? throw new InvalidOperationException("There is no Campaign result to retry");
            Realm = last.Realm; Level = last.Level; PlayCampaign();
        }
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
                Unsaved = true; Open(TodayRun, error);
            }
        }
        public bool EmblemUnlocked(byte emblem) => emblem >= 1 && emblem <= ZKube.Presentation.ProfileEmblems.Last && Progress().EmblemUnlocked[emblem] != 0;
        public void Wear(byte emblem)
        {
            Check();
            if (!EmblemUnlocked(emblem)) throw new InvalidOperationException("Earn this emblem first");
            Write(state => state.WornEmblem = emblem); Changed?.Invoke();
        }
        // A finished Campaign run passes its outcome to the result page; leaving a
        // run any other way returns to the map.
        public void LeaveBoard(CampaignOutcome outcome = null)
        {
            Check(); ObservePersistence();
            bool daily = Provider?.Daily == true;
            if (!daily && outcome != null) { outcome.PreviousStars = startingStars; startingStars = LevelStars(outcome.Realm, outcome.Level); }
            LastCampaign = daily ? null : outcome;
            var attempt = Product.Read.DailyAttempt;
            if (daily && attempt != null && attempt.Finished && HasLeaderboard) accounts.SubmitDailyScore(attempt.DailyScore);
            Navigate(daily || outcome != null ? StorePage.Result : StorePage.Campaign);
        }
        public void ObservePersistence()
        {
            if (Provider?.PersistenceFailure != null) Unsaved = true;
        }
        public async Task RefreshBilling(bool purchase = false)
        {
            Check();
            if (Billing.Busy) return;
            long request = generation; var cancellation = pageWait.Token;
            Error = null; BillingNotice = "Checking purchases…"; Changed?.Invoke();
            try
            {
                var answer = purchase ? await Billing.Purchase(cancellation) : await Billing.Query(cancellation);
                if (!Current(request)) return;
                StoreUnavailable = false;
                BillingNotice = answer.Status == CampaignBillingStatus.PaymentPending ? "Payment is pending. Campaign unlocks after payment completes."
                    : answer.Status == CampaignBillingStatus.ConfirmationPending ? "Campaign unlocked. Store confirmation is pending; restore purchases to check again."
                    : answer.Owned ? "Full Campaign unlocked" : null;
            }
            catch (OperationCanceledException)
            { if (Current(request)) BillingNotice = Billing.Busy ? "The store operation is still in progress." : "Purchase cancelled"; }
            // A store failure is a billing notice: it shows where purchase and
            // restore are, never on the Home the app opens on.
            catch (Exception error) { if (Current(request)) { BillingNotice = error.Message; StoreUnavailable = true; } }
            finally { if (Current(request)) Changed?.Invoke(); }
        }
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
            catch { if (!ReferenceEquals(before, Product.Read)) Unsaved = true; throw; }
        }
        // A Campaign outcome belongs to the result page its run opened; leaving
        // that page lets it go, so the next result page (today's Daily from
        // View result) shows its own result.
        private void Navigate(StorePage page)
        {
            if (page != StorePage.Result) LastCampaign = null;
            generation++; var old = pageWait; pageWait = new CancellationTokenSource();
            Page = page; Error = null; BillingNotice = null; old.Cancel(); old.Dispose(); Changed?.Invoke();
        }
        private bool Current(long value) => !disposed && value == generation;
        private void Check() { if (disposed) throw new ObjectDisposedException(nameof(StoreAppFlow)); }
        public void Dispose() { if (disposed) return; disposed = true; generation++; pageWait.Cancel(); pageWait.Dispose(); }
    }
}
