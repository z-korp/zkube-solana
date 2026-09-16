using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Local;
using ZKube.Local.Billing;

namespace ZKube.Tests.LocalBilling
{
    public sealed class CampaignBillingTests
    {
        private sealed class Store : ICampaignStoreDriver
        {
            public event Action<string> ProductFetched;
            public event Action<CampaignOrder[]> PurchasesFetched;
            public event Action<CampaignOrder> PurchasePaid;
            public event Action PurchaseDeferred;
            public event Action<bool> PurchaseRejected;
            public event Action<string, bool> PurchaseConfirmed;
            public event Action<string> QueryFailed;
            public event Action Disconnected;
            public string Price = "€0.99", Failure;
            public bool HoldQuery, AutoConfirm = true;
            public Task ConnectTask = Task.CompletedTask;
            public CampaignOrder[] Orders = Array.Empty<CampaignOrder>();
            public int Purchases, Confirmations, Queries;
            public Action Buy, BeforeConfirm;
            public Task Connect() => ConnectTask;
            public void FetchProduct()
            { if (Failure == "product") QueryFailed?.Invoke("product failure"); else ProductFetched?.Invoke(Price); }
            public void FetchPurchases()
            { Queries++; if (Failure == "query") QueryFailed?.Invoke("query failure"); else if (!HoldQuery) FinishQuery(); }
            public void FinishQuery() => PurchasesFetched?.Invoke(Orders);
            public void Purchase() { Purchases++; Buy?.Invoke(); }
            public void Paid(string id = "paid-1")
            {
                var order = new CampaignOrder(CampaignBilling.ProductId, id, CampaignOrderState.PaidUnconfirmed);
                Orders = new[] { order }; PurchasePaid?.Invoke(order);
            }
            public void Deferred()
            { Orders = new[] { new CampaignOrder(CampaignBilling.ProductId, null, CampaignOrderState.Deferred) }; PurchaseDeferred?.Invoke(); }
            public void Reject(bool canceled) => PurchaseRejected?.Invoke(canceled);
            public void Confirm(CampaignOrder order)
            {
                BeforeConfirm?.Invoke(); Confirmations++;
                if (AutoConfirm)
                {
                    Orders = new[] { new CampaignOrder(CampaignBilling.ProductId, order.TransactionId, CampaignOrderState.Confirmed) };
                    PurchaseConfirmed?.Invoke(order.TransactionId, true);
                }
            }
            public void ConfirmationFailed(string id) => PurchaseConfirmed?.Invoke(id, false);
            public void Disconnect() => Disconnected?.Invoke();
            public void Dispose() { }
        }
        private sealed class ProductCache
        {
            public string Json;
            public bool FailWrite;
            public LocalProductStore Store;
            public ProductCache(bool owned = false, string price = "$0.99")
            {
                Json = LocalProductCodec.Encode(new LocalProductState { CampaignOwned = owned, CampaignPrice = price });
                Store = new LocalProductStore(_ => Json, (_, value) => {
                    if (FailWrite) throw new InvalidOperationException("disk unavailable"); Json = value;
                });
            }
            public CampaignBillingAnswer Read() => new CampaignBillingAnswer(Store.Read.CampaignOwned, Store.Read.CampaignPrice, CampaignBillingStatus.Updated);
            public void Apply(bool owned, string price)
            {
                var next = LocalProductCodec.Decode(LocalProductCodec.Encode(Store.Read));
                next.CampaignOwned = owned; next.CampaignPrice = price;
                Store.Write(_ => next);
            }
            public bool DurableOwned => LocalProductCodec.Decode(Json).CampaignOwned;
        }
        private static async Task<T> Failure<T>(Func<Task> action) where T : Exception
        {
            try { await action(); }
            catch (T error) { return error; }
            Assert.Fail("Expected " + typeof(T).Name); return null;
        }

        [Test] public async Task SuccessfulFalseReplacesCachedOwnershipAndLocalizedPrice()
        {
            var cache = new ProductCache(true); var store = new Store();
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var answer = await billing.Query();
                Assert.IsFalse(answer.Owned); Assert.AreEqual("€0.99", answer.Price);
                Assert.IsFalse(cache.DurableOwned); Assert.AreEqual(0, store.Purchases);
            }
        }
        [TestCase("product")] [TestCase("query")]
        public async Task FailedQueryPreservesBothCachedFields(string failure)
        {
            var cache = new ProductCache(true); string before = cache.Json;
            var store = new Store { Failure = failure };
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                await Failure<InvalidOperationException>(() => billing.Query());
                Assert.AreEqual(before, cache.Json); Assert.IsTrue(cache.Read().Owned);
                Assert.AreEqual("$0.99", cache.Read().Price);
            }
        }
        [Test] public async Task MissingProductPriceIsNullAfterSuccessfulOwnedQuery()
        {
            var cache = new ProductCache(); var store = new Store { Price = null,
                Orders = new[] { new CampaignOrder(CampaignBilling.ProductId, "old", CampaignOrderState.Confirmed) } };
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            { var result = await billing.Query(); Assert.IsTrue(result.Owned); Assert.IsNull(result.Price); }
        }
        [Test] public async Task PaidPurchasePersistsBeforeAcknowledgementAndRequeries()
        {
            var cache = new ProductCache(); var store = new Store();
            store.Buy = () => store.Paid(); store.BeforeConfirm = () => Assert.IsTrue(cache.DurableOwned);
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var answer = await billing.Purchase();
                Assert.IsTrue(answer.Owned); Assert.AreEqual(CampaignBillingStatus.Updated, answer.Status);
                Assert.AreEqual(1, store.Purchases); Assert.AreEqual(1, store.Confirmations); Assert.AreEqual(2, store.Queries);
            }
        }
        [Test] public async Task DeferredPaymentDoesNotUnlockOrAcknowledgeAndCanFinishLater()
        {
            var cache = new ProductCache(); var store = new Store(); store.Buy = store.Deferred;
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var answer = await billing.Purchase();
                Assert.IsFalse(answer.Owned); Assert.AreEqual(CampaignBillingStatus.PaymentPending, answer.Status);
                Assert.AreEqual(0, store.Confirmations);
                await billing.Purchase(); Assert.AreEqual(1, store.Purchases);
                store.Paid(); Assert.IsTrue(cache.DurableOwned); Assert.AreEqual(1, store.Confirmations);
            }
        }
        [Test] public async Task UserCancellationDoesNotGrantOrAcknowledge()
        {
            var cache = new ProductCache(); var store = new Store(); store.Buy = () => store.Reject(true);
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                await Failure<OperationCanceledException>(() => billing.Purchase());
                Assert.IsFalse(cache.DurableOwned); Assert.AreEqual(0, store.Confirmations); Assert.IsFalse(billing.Busy);
            }
        }
        [Test] public async Task CanceledUiRetainsNativeOperationAndLaterPaidFulfillment()
        {
            var cache = new ProductCache(); var store = new Store();
            using (var cancellation = new CancellationTokenSource())
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var task = billing.Purchase(cancellation.Token); cancellation.Cancel();
                await Failure<OperationCanceledException>(() => task);
                Assert.IsTrue(billing.Busy);
                await Failure<InvalidOperationException>(() => billing.Purchase());
                store.Paid(); Assert.IsTrue(cache.DurableOwned); Assert.IsFalse(billing.Busy);
                Assert.AreEqual(1, store.Purchases);
            }
        }
        [Test] public async Task CancellationDuringPrepurchaseQueryNeverLaunchesPurchase()
        {
            var cache = new ProductCache(); var store = new Store { HoldQuery = true };
            using (var cancellation = new CancellationTokenSource())
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var task = billing.Purchase(cancellation.Token); cancellation.Cancel();
                await Failure<OperationCanceledException>(() => task);
                store.FinishQuery(); Assert.AreEqual(0, store.Purchases); Assert.IsFalse(billing.Busy);
            }
        }
        [Test] public async Task UnacknowledgedPaidOrderRestoresAndRetriesAfterFailure()
        {
            var cache = new ProductCache(); var store = new Store { AutoConfirm = false,
                Orders = new[] { new CampaignOrder(CampaignBilling.ProductId, "restart", CampaignOrderState.PaidUnconfirmed) } };
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var answer = await billing.Query();
                Assert.IsTrue(answer.Owned); Assert.AreEqual(CampaignBillingStatus.ConfirmationPending, answer.Status);
                store.ConfirmationFailed("restart"); store.AutoConfirm = true;
                Assert.IsTrue(cache.DurableOwned);
                answer = await billing.Query(); Assert.AreEqual(CampaignBillingStatus.Updated, answer.Status);
                Assert.AreEqual(2, store.Confirmations);
            }
        }
        [Test] public async Task PersistenceFailureNeverAcknowledgesAndRestartCanRecover()
        {
            var cache = new ProductCache { FailWrite = true }; var store = new Store();
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                store.Paid(); Assert.AreEqual(0, store.Confirmations); Assert.IsFalse(cache.DurableOwned);
                Assert.IsNotNull(billing.LastFulfillmentError);
                cache.FailWrite = false;
                Assert.IsTrue((await billing.Query()).Owned); Assert.AreEqual(1, store.Confirmations);
            }
        }
        [Test] public async Task LateFalseQueryCannotUndoPaidEvent()
        {
            var cache = new ProductCache(); var store = new Store { HoldQuery = true };
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                var query = billing.Query(); store.Paid(); store.Orders = Array.Empty<CampaignOrder>(); store.FinishQuery();
                await Failure<InvalidOperationException>(() => query); Assert.IsTrue(cache.DurableOwned);
            }
        }
        [Test] public async Task DuplicatePaidCallbackCannotReacknowledgeOrUndoLaterRevocation()
        {
            var cache = new ProductCache(); var store = new Store();
            using (var billing = new CampaignBilling(store, cache.Read, cache.Apply))
            {
                store.Paid(); store.Paid(); Assert.AreEqual(1, store.Confirmations);
                store.Orders = Array.Empty<CampaignOrder>(); await billing.Query();
                Assert.IsFalse(cache.DurableOwned);
                store.Paid(); Assert.IsFalse(cache.DurableOwned); Assert.AreEqual(1, store.Confirmations);
            }
        }
        [Test] public async Task DisconnectionAndDisposalRetainCacheAndDetachCallbacks()
        {
            var cache = new ProductCache(true); var store = new Store { HoldQuery = true };
            var billing = new CampaignBilling(store, cache.Read, cache.Apply);
            var query = billing.Query(); store.Disconnect();
            await Failure<InvalidOperationException>(() => query); Assert.IsTrue(cache.DurableOwned);
            billing.Dispose(); billing.Dispose(); string before = cache.Json;
            store.Paid(); Assert.AreEqual(before, cache.Json); Assert.AreEqual(0, store.Confirmations);
        }
        [Test] public async Task DisposalWakesCallerWaitingForConnection()
        {
            var cache = new ProductCache(); var connect = new TaskCompletionSource<bool>();
            var store = new Store { ConnectTask = connect.Task };
            var billing = new CampaignBilling(store, cache.Read, cache.Apply);
            var query = billing.Query(); billing.Dispose();
            await Failure<ObjectDisposedException>(() => query);
            connect.SetResult(true); Assert.AreEqual(0, store.Queries);
        }
    }
}
