#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Threading.Tasks;
using ZKube.Local.Billing;

namespace ZKube.Local.App
{
    // Offline evidence only. No Google connection or payment is performed.
    internal sealed class OfflineCampaignStoreDriver : ICampaignStoreDriver
    {
        internal const string FileName = "offline-campaign-store-v1.txt";
        private readonly Action<string> write;
        private CampaignOrder order;
        public OfflineCampaignStoreDriver(Func<string> read, Action<string> write)
        {
            if (read == null) throw new ArgumentNullException(nameof(read));
            this.write = write ?? throw new ArgumentNullException(nameof(write));
            string saved = read();
            if (saved == null) return;
            if (saved != "paid-unconfirmed" && saved != "confirmed")
                throw new FormatException("Offline evidence store state is invalid");
            order = new CampaignOrder(CampaignBilling.ProductId, "offline-campaign",
                saved == "confirmed" ? CampaignOrderState.Confirmed : CampaignOrderState.PaidUnconfirmed);
        }
        public event Action<string> ProductFetched;
        public event Action<CampaignOrder[]> PurchasesFetched;
        public event Action<CampaignOrder> PurchasePaid;
        public event Action PurchaseDeferred { add { } remove { } }
        public event Action<bool> PurchaseRejected { add { } remove { } }
        public event Action<string, bool> PurchaseConfirmed;
        public event Action<string> QueryFailed { add { } remove { } }
        public event Action Disconnected { add { } remove { } }
        public Task Connect() => Task.CompletedTask;
        public void FetchProduct() => ProductFetched?.Invoke("Offline test purchase");
        public void FetchPurchases() => PurchasesFetched?.Invoke(order == null ? Array.Empty<CampaignOrder>() : new[] { order });
        public void Purchase()
        {
            // This file models the fake store, never the product's entitlement.
            // A process can exit after payment and before durable fulfillment.
            write("paid-unconfirmed");
            order = new CampaignOrder(CampaignBilling.ProductId, "offline-campaign", CampaignOrderState.PaidUnconfirmed);
            PurchasePaid?.Invoke(order);
        }
        public void Confirm(CampaignOrder paid)
        {
            if (paid == null || paid.State != CampaignOrderState.PaidUnconfirmed || !ReferenceEquals(paid, order))
                throw new InvalidOperationException("Offline order changed");
            write("confirmed");
            order = new CampaignOrder(CampaignBilling.ProductId, paid.TransactionId, CampaignOrderState.Confirmed);
            PurchaseConfirmed?.Invoke(paid.TransactionId, true);
        }
        public void Dispose() { }
    }
}
#endif
