namespace ZKube.Local.Billing
{
    public static class StoreCampaignBillingFactory
    {
        // Construct once on the Unity main thread for the app lifetime. The
        // presentation owner calls Query on startup/foreground, and disposes on
        // shutdown. No store connection starts merely by loading this assembly.
        public static CampaignBilling Create(LocalProductStore product, System.Action<bool, string> applyEntitlement)
        {
            if (product == null) throw new System.ArgumentNullException(nameof(product));
            if (applyEntitlement == null) throw new System.ArgumentNullException(nameof(applyEntitlement));
            return new CampaignBilling(new UnityCampaignStoreDriver(),
                () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated),
                applyEntitlement);
        }
    }
}
