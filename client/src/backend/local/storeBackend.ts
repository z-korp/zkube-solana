import type { BackendLayer } from "@/backend/runtime";
import {
  LOCAL_BACKEND_SENTINEL,
  makeLocalBackendLive,
} from "./LocalBackendLive";
import { nativeCampaignBilling } from "./storeBilling";

export const SELECTED_BACKEND_SENTINEL = LOCAL_BACKEND_SENTINEL;
export const SELECTED_BUILD_SENTINEL: string | undefined = undefined;

export function makeSelectedBackend(): BackendLayer {
  return makeLocalBackendLive({
    target: "store",
    campaignBilling: nativeCampaignBilling,
  });
}
