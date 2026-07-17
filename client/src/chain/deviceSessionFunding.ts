import { SystemProgram, type AccountInfo } from "@solana/web3.js";
import { errorMessage } from "../utils/errors.js";

/** Owner-funded allowance assigned to each origin-scoped device signer. */
export const DEVICE_FEE_ALLOWANCE_LAMPORTS = 5_000_000;

/** One ordinary base-layer signature fee, retained for final settlement. */
export const DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS = 5_000;

/** A ready session can both launch and later settle one run. */
const DEVICE_READY_FEE_RESERVE_LAMPORTS =
  DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS * 2;

export const DEVICE_SESSION_RENEWAL_ERROR_CODE =
  "ZKUBE_DEVICE_SESSION_RENEWAL_REQUIRED";

export type DeviceSignerFundingStatus = "ready" | "needsRenewal";

export function requiredDeviceSignerBalance(
  rentFloorLamports: number,
  feeReserveLamports = DEVICE_READY_FEE_RESERVE_LAMPORTS,
): number {
  requireLamportAmount(rentFloorLamports, "device signer rent floor");
  requireLamportAmount(feeReserveLamports, "device signer fee reserve");
  const required = rentFloorLamports + feeReserveLamports;
  if (!Number.isSafeInteger(required)) {
    throw new Error("Device signer balance requirement is unsafe");
  }
  return required;
}

/**
 * A stored session signer is a plain System account. Missing accounts are
 * treated as drained sessions so the owner can renew without losing the local
 * token metadata; malformed accounts are rejected as invalid session state.
 */
export function validateDeviceSignerFunding(args: {
  info: AccountInfo<Buffer> | null;
  rentFloorLamports: number;
  feeReserveLamports?: number;
}): DeviceSignerFundingStatus {
  const { info } = args;
  if (!info) return "needsRenewal";
  const balanceLamports = validatedDeviceSignerBalance(info);
  return balanceLamports >=
    requiredDeviceSignerBalance(args.rentFloorLamports, args.feeReserveLamports)
    ? "ready"
    : "needsRenewal";
}

export function validatedDeviceSignerBalance(
  info: AccountInfo<Buffer>,
): number {
  if (
    info.executable ||
    !info.owner.equals(SystemProgram.programId) ||
    info.data.length !== 0
  ) {
    throw new Error("Stored device signer has an invalid account layout");
  }
  requireLamportAmount(info.lamports, "device signer balance");
  return info.lamports;
}

export function deviceSignerTopUpLamports(balanceLamports: number): number {
  requireLamportAmount(balanceLamports, "device signer balance");
  return Math.max(0, DEVICE_FEE_ALLOWANCE_LAMPORTS - balanceLamports);
}

/** Exact message-fee check used after a transaction has been compiled. */
export function assertDeviceSignerCanPay(args: {
  balanceLamports: number;
  rentFloorLamports: number;
  transactionFeeLamports: number;
  postFeeReserveLamports?: number;
}): void {
  requireLamportAmount(args.balanceLamports, "device signer balance");
  requireLamportAmount(args.transactionFeeLamports, "transaction fee");
  const required =
    requiredDeviceSignerBalance(
      args.rentFloorLamports,
      args.postFeeReserveLamports ?? 0,
    ) + args.transactionFeeLamports;
  if (!Number.isSafeInteger(required)) {
    throw new Error("Device signer transaction requirement is unsafe");
  }
  if (args.balanceLamports < required) {
    throw deviceSessionRenewalError(
      `The device fee allowance cannot cover this transaction and its required reserve (${args.balanceLamports} < ${required} lamports).`,
    );
  }
}

function deviceSessionRenewalError(detail?: string): Error {
  return new Error(
    `${DEVICE_SESSION_RENEWAL_ERROR_CODE}: ${
      detail ?? "Renew zKube to refill this device's fee allowance."
    }`,
  );
}

export function isDeviceSessionRenewalError(value: unknown): boolean {
  const message = errorMessage(value);
  return (
    message.includes(DEVICE_SESSION_RENEWAL_ERROR_CODE) ||
    (message.includes("Simulation failed for") &&
      (message.includes('"Custom":1') ||
        message.includes("InsufficientFundsForRent")))
  );
}

function requireLamportAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
}
