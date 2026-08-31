import {
  NativePurchases,
  PURCHASE_TYPE,
  type Transaction,
} from "@capgo/native-purchases";

export const CAMPAIGN_PRODUCT_ID = "com.zkorp.zkube.campaign";

export interface CampaignStoreAnswer {
  readonly campaignOwned: boolean;
  readonly price: string | null;
}

export interface CampaignBilling {
  readonly queryCampaign: () => Promise<CampaignStoreAnswer>;
  readonly purchaseCampaign: () => Promise<void>;
  readonly restorePurchases: () => Promise<void>;
}

/** Direct StoreKit 2 / Google Play Billing adapter; no entitlement server. */
export const nativeCampaignBilling: CampaignBilling = {
  queryCampaign: async () => {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    if (!isBillingSupported) throw new Error("Purchases are unavailable");
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: [CAMPAIGN_PRODUCT_ID],
      productType: PURCHASE_TYPE.INAPP,
    });
    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.INAPP,
      onlyCurrentEntitlements: true,
    });
    return {
      campaignOwned: purchases.some(isOwnedCampaignTransaction),
      price:
        products.find((product) => product.identifier === CAMPAIGN_PRODUCT_ID)
          ?.priceString ?? null,
    };
  },
  purchaseCampaign: async () => {
    await NativePurchases.purchaseProduct({
      productIdentifier: CAMPAIGN_PRODUCT_ID,
      productType: PURCHASE_TYPE.INAPP,
      quantity: 1,
      isConsumable: false,
    });
  },
  restorePurchases: async () => {
    await NativePurchases.restorePurchases();
  },
};

function isOwnedCampaignTransaction(transaction: Transaction): boolean {
  return (
    transaction.productIdentifier === CAMPAIGN_PRODUCT_ID &&
    transaction.isActive !== false &&
    (transaction.purchaseState === undefined ||
      transaction.purchaseState === "1")
  );
}
