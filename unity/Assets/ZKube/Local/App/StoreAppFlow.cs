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
    public enum StorePage { Name, Daily, Campaign, Level, Profile, Settings, Board, Result }

    // The concrete store page flow. Campaign recovery uses the same durable
    // local record as the money identity, with the store purchase policy.
    public sealed class StoreAppFlow : IDisposable
    {
        public readonly LocalProductStore Product;
        public readonly StoreRunClient Runs;
        public readonly CampaignBilling Billing;
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
        public bool Unsaved { get; private set; }
        public event Action Changed;
        public event Action<LocalBoardActionProvider> BoardOpened;
        public StoreAppFlow(LocalProductStore product, StoreRunClient runs, CampaignBilling billing)
        {
            Product = product ?? throw new ArgumentNullException(nameof(product));
            Runs = runs ?? throw new ArgumentNullException(nameof(runs));
            Billing = billing ?? throw new ArgumentNullException(nameof(billing));
            Page = Product.Read.Name == null ? StorePage.Name : StorePage.Daily;
        }
        public LocalDaily Today => Runs.Today();
        public LocalRunView TodayRun => Product.Read.DailyAttempt?.DayId == Today.DayId ? Runs.Active("arcade") : null;
        public bool AttemptedToday => Product.Read.DailyAttempt?.DayId == Today.DayId;
        public string DailyAction => TodayRun != null ? "Resume run" : AttemptedToday ? "View result" : "Play today";
        public bool Cleared(byte realm) => Progress().Cleared[realm - 1] != 0;
        private CampaignProgressSummary Progress() => NativeEngine.CampaignProgress(NativeEngine.PackCampaignStars(Product.Read.Stars));
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
            Navigate(Product.Read.Name == null ? StorePage.Name : page);
        }
        public void SetName(string name)
        {
            Check();
            try { Write(state => state.Name = LocalProductCodec.NormalizeName(name)); Navigate(StorePage.Daily); }
            catch (Exception error) { Error = error.Message; Changed?.Invoke(); }
        }
        public void SelectRealm(byte realm)
        {
            Check(); RequireName();
            if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
            Realm = realm; Navigate(StorePage.Campaign);
        }
        public void Preview(byte level)
        {
            Check(); RequireName();
            if (!LevelAvailable(Realm, level)) throw new InvalidOperationException("Clear the preceding trial first");
            Level = level; Navigate(StorePage.Level);
        }
        public void PlayCampaign()
        {
            Check(); RequireName();
            var current = Runs.Active("campaign");
            if (current != null)
            {
                if (current.Realm != Realm || current.Level != Level)
                    throw new InvalidOperationException($"Run in progress in realm {current.Realm}, level {current.Level}");
                Open(current); return;
            }
            if (!LevelAvailable(Realm, Level)) throw new InvalidOperationException("This trial is locked");
            Open(Runs.StartCampaign(Realm, Level));
        }
        public void PlayDaily()
        {
            Check(); RequireName();
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
        public void Wear(byte realm)
        {
            Check(); RequireName();
            if (realm < 1 || realm > Protocol.Realms.Length || !Cleared(realm)) throw new InvalidOperationException("Defeat this guardian first");
            Write(state => state.WornEmblem = realm); Changed?.Invoke();
        }
        public void LeaveBoard()
        {
            Check(); ObservePersistence();
            Navigate(Provider?.Bind(null).Daily == true ? StorePage.Result : StorePage.Campaign);
        }
        public void ObservePersistence()
        {
            if (Provider?.PersistenceFailure != null) Unsaved = true;
        }
        public async Task RefreshBilling(bool purchase = false, bool restore = false)
        {
            Check();
            if (Billing.Busy) return;
            long request = generation; var cancellation = pageWait.Token;
            Error = null; BillingNotice = "Checking purchases…"; Changed?.Invoke();
            try
            {
                var answer = purchase ? await Billing.Purchase(cancellation) : restore ? await Billing.Restore(cancellation) : await Billing.Query(cancellation);
                if (!Current(request)) return;
                BillingNotice = answer.Status == CampaignBillingStatus.PaymentPending ? "Payment is pending. Campaign unlocks after payment completes."
                    : answer.Status == CampaignBillingStatus.ConfirmationPending ? "Campaign unlocked. Store confirmation is pending; restore purchases to check again."
                    : answer.Owned ? "Full Campaign unlocked" : null;
            }
            catch (OperationCanceledException)
            { if (Current(request)) BillingNotice = Billing.Busy ? "The store operation is still in progress." : "Purchase cancelled"; }
            catch (Exception error) { if (Current(request)) { Error = error.Message; BillingNotice = null; } }
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
        private void Navigate(StorePage page)
        {
            generation++; var old = pageWait; pageWait = new CancellationTokenSource();
            Page = page; Error = null; BillingNotice = null; old.Cancel(); old.Dispose(); Changed?.Invoke();
        }
        private bool Current(long value) => !disposed && value == generation;
        private void RequireName() { if (Product.Read.Name == null) throw new InvalidOperationException("Choose your player name first"); }
        private void Check() { if (disposed) throw new ObjectDisposedException(nameof(StoreAppFlow)); }
        public void Dispose() { if (disposed) return; disposed = true; generation++; pageWait.Cancel(); pageWait.Dispose(); }
    }
}
