import { errorMessage } from "@/utils/errors";
import { isDeviceSessionRenewalError } from "./deviceSessionFunding";

type RunStartFailureKind =
  | "deviceSessionRenewal"
  | "runDiscoveryPending"
  | "activeRunExists"
  | "unknown";

export interface DescribedRunStartError {
  kind: RunStartFailureKind;
  headline: string;
  detail: string | null;
}

const RUN_DISCOVERY_PENDING_ERROR_CODE =
  "ZKUBE_RUN_DISCOVERY_PENDING";

export function runDiscoveryPendingError(): Error {
  return new Error(
    `${RUN_DISCOVERY_PENDING_ERROR_CODE}: Still checking for an active run on another device.`,
  );
}

export function isActiveRunConflict(value: unknown): boolean {
  const message = errorMessage(value);
  return /Run \d+ is already active\./.test(message);
}

export function describeRunStartError(value: unknown): DescribedRunStartError {
  const message = errorMessage(value);
  if (isDeviceSessionRenewalError(value)) {
    return {
      kind: "deviceSessionRenewal",
      headline:
        "This device's zKube fee allowance is low — renew zKube to keep playing.",
      detail: message,
    };
  }
  if (message.includes(RUN_DISCOVERY_PENDING_ERROR_CODE)) {
    return {
      kind: "runDiscoveryPending",
      headline: "Still checking for an active run — try again in a moment.",
      detail: null,
    };
  }
  if (isActiveRunConflict(message)) {
    return {
      kind: "activeRunExists",
      headline:
        "A run is already active on this wallet. Resume or abandon it before starting another.",
      detail: null,
    };
  }
  return { kind: "unknown", headline: message, detail: null };
}
