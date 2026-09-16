using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Local.Billing
{
    public enum CampaignOrderState { PaidUnconfirmed, Confirmed, Deferred }
    public enum CampaignBillingStatus { Updated, PaymentPending, ConfirmationPending }

    public sealed class CampaignOrder
    {
        public string ProductId { get; }
        public string TransactionId { get; }
        public CampaignOrderState State { get; }
        public object NativeHandle { get; }
        public CampaignOrder(string productId, string transactionId, CampaignOrderState state, object nativeHandle = null)
        { ProductId = productId; TransactionId = transactionId; State = state; NativeHandle = nativeHandle; }
    }

    public sealed class CampaignBillingAnswer
    {
        public bool Owned { get; }
        public string Price { get; }
        public CampaignBillingStatus Status { get; }
        public CampaignBillingAnswer(bool owned, string price, CampaignBillingStatus status)
        { Owned = owned; Price = price; Status = status; }
    }

    // One Google nonconsumable. The driver maps documented IAP events to this
    // boundary; it never writes product state or interprets cached receipts.
    public interface ICampaignStoreDriver : IDisposable
    {
        event Action<string> ProductFetched;
        event Action<CampaignOrder[]> PurchasesFetched;
        event Action<CampaignOrder> PurchasePaid;
        event Action PurchaseDeferred;
        event Action<bool> PurchaseRejected;
        event Action<string, bool> PurchaseConfirmed;
        event Action<string> QueryFailed;
        event Action Disconnected;
        Task Connect();
        void FetchProduct();
        void FetchPurchases();
        void Purchase();
        void Confirm(CampaignOrder order);
    }

    // App-scoped, called on the captured Unity main thread. Cancellation stops
    // a caller's wait, never a launched Google purchase or its later fulfillment.
    // Native requests cannot be cancelled/correlated by request ID, so a detached
    // operation retains the single operation slot until its callback arrives.
    public sealed class CampaignBilling : IDisposable
    {
        public const string ProductId = "com.zkorp.zkube.campaign";
        private readonly ICampaignStoreDriver driver;
        private readonly Func<CampaignBillingAnswer> cached;
        private readonly Action<bool, string> apply;
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private readonly Dictionary<string, CampaignOrder> unconfirmed = new Dictionary<string, CampaignOrder>();
        private readonly HashSet<string> confirming = new HashSet<string>();
        private readonly HashSet<string> confirmed = new HashSet<string>();
        private TaskCompletionSource<string> productWait;
        private TaskCompletionSource<CampaignOrder[]> queryWait;
        private TaskCompletionSource<bool> purchaseWait;
        private readonly TaskCompletionSource<bool> disposedWait = NewWait<bool>();
        private bool active, disposed;
        private long paidRevision;
        public Exception LastFulfillmentError { get; private set; }
        public bool Busy => active;

        // Production composition passes the store entitlement writer,
        // preserving the existing normalized local persistence/run-lock boundary.
        public CampaignBilling(ICampaignStoreDriver driver, Func<CampaignBillingAnswer> cached,
                               Action<bool, string> applySuccessfulAnswer)
        {
            this.driver = driver ?? throw new ArgumentNullException(nameof(driver));
            this.cached = cached ?? throw new ArgumentNullException(nameof(cached));
            apply = applySuccessfulAnswer ?? throw new ArgumentNullException(nameof(applySuccessfulAnswer));
            driver.ProductFetched += Product; driver.PurchasesFetched += Purchases;
            driver.PurchasePaid += Paid; driver.PurchaseDeferred += Deferred;
            driver.PurchaseRejected += Rejected; driver.PurchaseConfirmed += Confirmed;
            driver.QueryFailed += Failed; driver.Disconnected += Disconnected;
        }

        public Task<CampaignBillingAnswer> Query(CancellationToken cancellation = default)
            => Start(Refresh, cancellation);
        public Task<CampaignBillingAnswer> Purchase(CancellationToken cancellation = default)
            => Start(async () =>
            {
                var current = await Refresh();
                if (current.Owned || current.Status == CampaignBillingStatus.PaymentPending) return current;
                cancellation.ThrowIfCancellationRequested();
                purchaseWait = NewWait<bool>();
                try
                {
                    driver.Purchase();
                    bool paid = await purchaseWait.Task;
                    if (!paid) return Snapshot(CampaignBillingStatus.PaymentPending);
                }
                finally { purchaseWait = null; }
                return await Refresh();
            }, cancellation);

        private Task<CampaignBillingAnswer> Start(Func<Task<CampaignBillingAnswer>> operation, CancellationToken cancellation)
        {
            Check(); cancellation.ThrowIfCancellationRequested();
            if (active) throw new InvalidOperationException("A store operation is still in progress");
            active = true;
            var task = Run(operation);
            // Observe a failure even if the UI detached through cancellation.
            _ = task.ContinueWith(failed => { _ = failed.Exception; }, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            return WaitForCaller(task, cancellation, disposedWait.Task);
        }
        private async Task<CampaignBillingAnswer> Run(Func<Task<CampaignBillingAnswer>> operation)
        {
            try { return await operation(); }
            finally { active = false; }
        }
        private static async Task<T> WaitForCaller<T>(Task<T> operation, CancellationToken cancellation, Task disposal)
        {
            var canceled = NewWait<bool>();
            using (cancellation.Register(() => canceled.TrySetResult(true)))
            {
                var completed = await Task.WhenAny(operation, canceled.Task, disposal);
                if (completed == disposal) throw new ObjectDisposedException(nameof(CampaignBilling));
                if (completed != operation)
                    throw new OperationCanceledException(cancellation);
                cancellation.ThrowIfCancellationRequested();
                return await operation;
            }
        }

        private async Task<CampaignBillingAnswer> Refresh()
        {
            await driver.Connect(); Check();
            string price;
            productWait = NewWait<string>();
            try { driver.FetchProduct(); price = await productWait.Task; }
            finally { productWait = null; }
            Check();
            long before = paidRevision;
            CampaignOrder[] orders;
            queryWait = NewWait<CampaignOrder[]>();
            try { driver.FetchPurchases(); orders = await queryWait.Task; }
            finally { queryWait = null; }
            Check();
            if (orders == null) throw new InvalidOperationException("Store returned an incomplete purchase query");
            bool owned = orders.Any(IsPaidCampaign);
            if (!owned && before != paidRevision)
                throw new InvalidOperationException("A purchase completed during the query; refresh ownership again");
            // Both true and false are authoritative only after both queries
            // succeed. Missing product metadata is a successful null price.
            apply(owned, price);
            foreach (var order in orders.Where(IsPaidCampaign))
                if (order.State == CampaignOrderState.PaidUnconfirmed) Fulfill(order);
                else
                {
                    unconfirmed.Remove(order.TransactionId ?? ""); confirming.Remove(order.TransactionId ?? "");
                    if (!string.IsNullOrEmpty(order.TransactionId)) confirmed.Add(order.TransactionId);
                }
            if (!owned) { unconfirmed.Clear(); confirming.Clear(); }
            var status = unconfirmed.Count > 0 ? CampaignBillingStatus.ConfirmationPending :
                orders.Any(order => order?.ProductId == ProductId && order.State == CampaignOrderState.Deferred)
                    ? CampaignBillingStatus.PaymentPending : CampaignBillingStatus.Updated;
            return Snapshot(status);
        }

        private static bool IsPaidCampaign(CampaignOrder order) => order?.ProductId == ProductId &&
            (order.State == CampaignOrderState.PaidUnconfirmed || order.State == CampaignOrderState.Confirmed);
        private CampaignBillingAnswer Snapshot(CampaignBillingStatus status)
        { var state = cached(); return new CampaignBillingAnswer(state.Owned, state.Price, status); }
        private void Product(string price) { if (!disposed) productWait?.TrySetResult(price); }
        private void Purchases(CampaignOrder[] orders) { if (!disposed) queryWait?.TrySetResult(orders); }
        private void Paid(CampaignOrder order)
        {
            if (disposed || !IsPaidCampaign(order) || order.State != CampaignOrderState.PaidUnconfirmed ||
                (order.TransactionId != null && confirmed.Contains(order.TransactionId))) return;
            try
            {
                Check(); paidRevision++;
                Fulfill(order);
                purchaseWait?.TrySetResult(true);
            }
            catch (Exception error)
            {
                LastFulfillmentError = error;
                purchaseWait?.TrySetException(error);
                queryWait?.TrySetException(error);
            }
        }
        private void Fulfill(CampaignOrder order)
        {
            if (string.IsNullOrEmpty(order.TransactionId))
                throw new InvalidOperationException("Paid Campaign order has no transaction identity");
            if (confirmed.Contains(order.TransactionId)) return;
            // Paid events can arrive after cancellation or a process restart.
            // Rewriting this boolean is idempotent; durable write must succeed
            // before acknowledgement, never a transient UI grant alone.
            apply(true, cached().Price);
            unconfirmed[order.TransactionId] = order;
            if (!confirming.Add(order.TransactionId)) return;
            try { LastFulfillmentError = null; driver.Confirm(order); }
            catch { confirming.Remove(order.TransactionId); throw; }
        }
        private void Confirmed(string transactionId, bool success)
        {
            if (disposed || string.IsNullOrEmpty(transactionId)) return;
            confirming.Remove(transactionId);
            if (success) { unconfirmed.Remove(transactionId); confirmed.Add(transactionId); LastFulfillmentError = null; }
            else LastFulfillmentError = new InvalidOperationException("Store acknowledgement failed; restore purchases to retry");
        }
        private void Deferred() { if (!disposed) purchaseWait?.TrySetResult(false); }
        private void Rejected(bool canceled)
        {
            if (disposed) return;
            if (canceled) purchaseWait?.TrySetCanceled();
            else purchaseWait?.TrySetException(new InvalidOperationException("Campaign purchase was rejected"));
        }
        private void Failed(string message)
        {
            if (disposed) return;
            var error = new InvalidOperationException(message);
            productWait?.TrySetException(error); queryWait?.TrySetException(error);
        }
        private void Disconnected()
        {
            if (disposed) return;
            confirming.Clear();
            Failed("Purchases are unavailable");
            purchaseWait?.TrySetException(new InvalidOperationException("Store disconnected during purchase; restore before retrying"));
        }
        private void Check()
        {
            if (disposed) throw new ObjectDisposedException(nameof(CampaignBilling));
            if (Thread.CurrentThread.ManagedThreadId != thread)
                throw new InvalidOperationException("Campaign billing requires its Unity main thread");
        }
        private static TaskCompletionSource<T> NewWait<T>() => new TaskCompletionSource<T>();
        public void Dispose()
        {
            if (disposed) return;
            Check();
            // Wake waiters before detaching the SDK; disposal must not erase
            // product entitlement or acknowledge an undelivered purchase.
            Disconnected(); disposed = true; disposedWait.TrySetResult(true);
            driver.ProductFetched -= Product; driver.PurchasesFetched -= Purchases;
            driver.PurchasePaid -= Paid; driver.PurchaseDeferred -= Deferred;
            driver.PurchaseRejected -= Rejected; driver.PurchaseConfirmed -= Confirmed;
            driver.QueryFailed -= Failed; driver.Disconnected -= Disconnected;
            driver.Dispose();
        }
    }
}
