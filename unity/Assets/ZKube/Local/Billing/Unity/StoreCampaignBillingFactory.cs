namespace ZKube.Local.Billing
{
    public static class StoreCampaignBillingFactory
    {
        // Construct once on the Unity main thread for the app lifetime. The
        // presentation owner calls Query on startup/foreground, and disposes on
        // shutdown. No store connection starts merely by loading this assembly.
        public static CampaignBilling Create(LocalProductStore product, LocalRunClient runs)
        {
            if (product == null) throw new System.ArgumentNullException(nameof(product));
            if (runs == null) throw new System.ArgumentNullException(nameof(runs));
            return new CampaignBilling(new UnityCampaignStoreDriver(),
                () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated),
                runs.ApplyCampaignEntitlement);
        }
    }
}
