import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const native = vi.hoisted(() => ({
  isBillingSupported: vi.fn(), getProducts: vi.fn(), getPurchases: vi.fn(),
  purchaseProduct: vi.fn(), restorePurchases: vi.fn(),
}));
vi.mock("@capgo/native-purchases", () => ({ NativePurchases: native, PURCHASE_TYPE: { INAPP: "inapp" } }));
import { CAMPAIGN_PRODUCT_ID, nativeCampaignBilling } from "@/backend/local/storeBilling";

describe("Unity Campaign billing native authority agreement", () => {
  it("uses the existing exact nonconsumable product and native purchase arguments", async () => {
    native.purchaseProduct.mockResolvedValue({});
    await nativeCampaignBilling.purchaseCampaign();
    expect(native.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: CAMPAIGN_PRODUCT_ID, productType: "inapp", quantity: 1, isConsumable: false,
    });
    const source = readFileSync(resolve(process.cwd(), process.env.ZKUBE_STAGED_BILLING_SOURCE ?? "../unity/Assets/ZKube/Local/Billing/CampaignBilling.cs"), "utf8");
    expect(source.match(/public const string ProductId = "([^"]+)"/)?.[1]).toBe(CAMPAIGN_PRODUCT_ID);
  });
  it.each([
    { name: "confirmed", purchases: [{ purchaseState: "1" }], owned: true },
    { name: "pending payment", purchases: [{ purchaseState: "2" }], owned: false },
    { name: "unspecified native state", purchases: [{}], owned: true },
    { name: "inactive", purchases: [{ purchaseState: "1", isActive: false }], owned: false },
    { name: "unowned", purchases: [], owned: false },
  ])("queries actual native ownership: $name", async (vector) => {
    native.isBillingSupported.mockResolvedValue({ isBillingSupported: true });
    native.getProducts.mockResolvedValue({ products: [{ identifier: CAMPAIGN_PRODUCT_ID, priceString: "€0.99" }] });
    native.getPurchases.mockResolvedValue({ purchases: vector.purchases.map((purchase) => ({ productIdentifier: CAMPAIGN_PRODUCT_ID, ...purchase })) });
    expect(await nativeCampaignBilling.queryCampaign()).toEqual({ campaignOwned: vector.owned, price: "€0.99" });
    expect(native.getPurchases).toHaveBeenCalledWith({ productType: "inapp", onlyCurrentEntitlements: true });
  });
});
