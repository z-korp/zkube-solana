using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Purchasing;

namespace ZKube.Local.Billing
{
    // com.unity.purchasing 5.2.1, Google Play only. No automatic initializer,
    // codeless catalogue, fake store, receipts server or analytics setup.
    public sealed class UnityCampaignStoreDriver : ICampaignStoreDriver
    {
        private readonly StoreController controller;
        private readonly SynchronizationContext main;
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private bool connected, disposed;
        private Task connecting;
        public event Action<string> ProductFetched;
        public event Action<CampaignOrder[]> PurchasesFetched;
        public event Action<CampaignOrder> PurchasePaid;
        public event Action PurchaseDeferred;
        public event Action<bool> PurchaseRejected;
        public event Action<string, bool> PurchaseConfirmed;
        public event Action<string> QueryFailed;
        public event Action Disconnected;

        public UnityCampaignStoreDriver()
        {
            if (Application.isEditor || Application.platform != RuntimePlatform.Android ||
                Application.identifier != "com.zkorp.zkube.store")
                throw new InvalidOperationException("Native Campaign billing requires the Google Play store identity");
            main = SynchronizationContext.Current ?? throw new InvalidOperationException("Construct billing on the Unity main thread");
            controller = new StoreController("GooglePlay");
            controller.ProcessPendingOrdersOnPurchasesFetched(false);
            controller.SetStoreReconnectionRetryPolicyOnDisconnection(null);
            controller.OnStoreConnected += QueueConnected;
            controller.OnStoreDisconnected += QueueStoreDisconnected;
            controller.OnProductsFetched += QueueProducts;
            controller.OnProductsFetchFailed += QueueProductsFailed;
            controller.OnPurchasesFetched += QueuePurchases;
            controller.OnPurchasesFetchFailed += QueuePurchasesFailed;
            controller.OnPurchasePending += QueuePaid;
            controller.OnPurchaseDeferred += QueueDeferred;
            controller.OnPurchaseFailed += QueueRejected;
            controller.OnPurchaseConfirmed += QueueConfirmed;
        }
        public Task Connect()
        {
            Check();
            if (connected) return Task.CompletedTask;
            return connecting != null && !connecting.IsCompleted ? connecting : (connecting = ConnectOnce());
        }
        private async Task ConnectOnce()
        {
            try
            {
                await controller.Connect(); Check();
                if (!connected) throw new InvalidOperationException("Purchases are unavailable");
            }
            finally { connecting = null; }
        }
        public void FetchProduct()
        {
            Check();
            controller.FetchProductsWithNoRetries(new List<ProductDefinition> {
                new ProductDefinition(CampaignBilling.ProductId, ProductType.NonConsumable)
            });
        }
        public void FetchPurchases() { Check(); controller.FetchPurchases(); }
        public void Purchase() { Check(); controller.PurchaseProduct(CampaignBilling.ProductId); }
        public void Confirm(CampaignOrder order)
        {
            Check();
            if (!(order.NativeHandle is PendingOrder pending) || !IsCampaign(pending) ||
                pending.Info.TransactionID != order.TransactionId)
                throw new InvalidOperationException("Campaign acknowledgement does not match its paid order");
            controller.ConfirmPurchase(pending);
        }
        private void Connected() { if (!disposed) connected = true; }
        private void StoreDisconnected(StoreConnectionFailureDescription reason)
        { connected = false; if (!disposed) Disconnected?.Invoke(); }
        private void Products(List<Product> products)
        {
            if (disposed) return;
            if (products == null) { QueryFailed?.Invoke("Store returned an incomplete product query"); return; }
            ProductFetched?.Invoke(products.FirstOrDefault(product => product?.definition?.id == CampaignBilling.ProductId)?.metadata?.localizedPriceString);
        }
        private void ProductsFailed(ProductFetchFailed failure)
        { if (!disposed) QueryFailed?.Invoke("Campaign product query failed"); }
        private void PurchasesFailed(PurchasesFetchFailureDescription failure)
        { if (!disposed) QueryFailed?.Invoke("Campaign ownership query failed"); }
        private static bool IsCampaign(Order order)
        {
            var items = order?.CartOrdered?.Items()?.ToArray();
            return items != null && items.Length == 1 && items[0].Quantity == 1 &&
                items[0].Product?.definition?.id == CampaignBilling.ProductId &&
                items[0].Product.definition.type == ProductType.NonConsumable;
        }
        private static CampaignOrder Convert(Order order, CampaignOrderState state)
            => new CampaignOrder(CampaignBilling.ProductId, order.Info?.TransactionID, state, order);
        private void Purchases(Orders orders)
        {
            if (disposed) return;
            if (orders?.ConfirmedOrders == null || orders.PendingOrders == null || orders.DeferredOrders == null)
            { QueryFailed?.Invoke("Store returned an incomplete ownership query"); return; }
            var result = orders.ConfirmedOrders.Where(IsCampaign).Select(order => Convert(order, CampaignOrderState.Confirmed))
                .Concat(orders.PendingOrders.Where(IsCampaign).Select(order => Convert(order, CampaignOrderState.PaidUnconfirmed)))
                .Concat(orders.DeferredOrders.Where(IsCampaign).Select(order => Convert(order, CampaignOrderState.Deferred))).ToArray();
            PurchasesFetched?.Invoke(result);
        }
        private void Paid(PendingOrder order)
        { if (!disposed && IsCampaign(order)) PurchasePaid?.Invoke(Convert(order, CampaignOrderState.PaidUnconfirmed)); }
        private void Deferred(DeferredOrder order)
        { if (!disposed && IsCampaign(order)) PurchaseDeferred?.Invoke(); }
        private void Rejected(FailedOrder order)
        {
            if (!disposed && (order?.CartOrdered == null || IsCampaign(order)))
                PurchaseRejected?.Invoke(order?.FailureReason == PurchaseFailureReason.UserCancelled);
        }
        private void Confirmed(Order order)
        {
            if (!disposed && IsCampaign(order))
                PurchaseConfirmed?.Invoke(order.Info?.TransactionID, order is ConfirmedOrder);
        }
        // Even if a store SDK callback arrives on another thread, all local
        // persistence and task completion returns to this Unity main context.
        private void Dispatch(Action callback)
        {
            if (disposed) return;
            if (Thread.CurrentThread.ManagedThreadId == thread) callback();
            else main.Post(_ => { if (!disposed) callback(); }, null);
        }
        private void QueueConnected() => Dispatch(Connected);
        private void QueueStoreDisconnected(StoreConnectionFailureDescription value) => Dispatch(() => StoreDisconnected(value));
        private void QueueProducts(List<Product> value) => Dispatch(() => Products(value));
        private void QueueProductsFailed(ProductFetchFailed value) => Dispatch(() => ProductsFailed(value));
        private void QueuePurchases(Orders value) => Dispatch(() => Purchases(value));
        private void QueuePurchasesFailed(PurchasesFetchFailureDescription value) => Dispatch(() => PurchasesFailed(value));
        private void QueuePaid(PendingOrder value) => Dispatch(() => Paid(value));
        private void QueueDeferred(DeferredOrder value) => Dispatch(() => Deferred(value));
        private void QueueRejected(FailedOrder value) => Dispatch(() => Rejected(value));
        private void QueueConfirmed(Order value) => Dispatch(() => Confirmed(value));
        private void Check()
        {
            if (disposed) throw new ObjectDisposedException(nameof(UnityCampaignStoreDriver));
            if (Thread.CurrentThread.ManagedThreadId != thread)
                throw new InvalidOperationException("Native billing requires the Unity main thread");
        }
        public void Dispose()
        {
            if (disposed) return;
            Check(); disposed = true;
            controller.OnStoreConnected -= QueueConnected;
            controller.OnStoreDisconnected -= QueueStoreDisconnected;
            controller.OnProductsFetched -= QueueProducts;
            controller.OnProductsFetchFailed -= QueueProductsFailed;
            controller.OnPurchasesFetched -= QueuePurchases;
            controller.OnPurchasesFetchFailed -= QueuePurchasesFailed;
            controller.OnPurchasePending -= QueuePaid;
            controller.OnPurchaseDeferred -= QueueDeferred;
            controller.OnPurchaseFailed -= QueueRejected;
            controller.OnPurchaseConfirmed -= QueueConfirmed;
        }
    }
}
