import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

import { deviceSignerTopUpLamports } from "./deviceSessionFunding";

export const DEVICE_SESSION_READY_SKEW_SECONDS = 60;
export const DEVICE_SESSION_EXPIRED_MESSAGE =
  "The zKube device session expired. Renew it before continuing.";

export class DeviceSessionExpiredError extends Error {
  override readonly name = "DeviceSessionExpiredError";
  readonly code = "session-expired";

  constructor() {
    super(DEVICE_SESSION_EXPIRED_MESSAGE);
  }
}

/**
 * Returns the remaining wall-clock delay before a device session must stop
 * authorizing writes. A non-positive result is already expired. Keeping this
 * calculation pure lets startup, foreground resume, and the live timer use the
 * same fail-closed boundary without touching recoverable run markers.
 */
export function deviceSessionExpiryDelayMs(
  validUntil: number,
  nowMs = Date.now(),
  readySkewSeconds = DEVICE_SESSION_READY_SKEW_SECONDS,
): number {
  if (
    !Number.isSafeInteger(validUntil) ||
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(readySkewSeconds) ||
    readySkewSeconds < 0
  ) {
    throw new Error("Device session expiry inputs are invalid");
  }
  return validUntil * 1_000 - nowMs - readySkewSeconds * 1_000;
}

export function buildDeviceSessionRefillInstructions(args: {
  owner: PublicKey;
  signer: PublicKey;
  balanceLamports: number;
}): { instructions: TransactionInstruction[]; topUpLamports: number } {
  const topUpLamports = deviceSignerTopUpLamports(args.balanceLamports);
  if (topUpLamports <= 0) {
    throw new Error("The device signer does not need a refill");
  }
  return {
    topUpLamports,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: args.owner,
        toPubkey: args.signer,
        lamports: topUpLamports,
      }),
      // This zero-value transfer proves control of the local signer in the
      // exact owner-approved message. It follows the top-up so a signer whose
      // zero balance removed its System account can be recreated in place.
      SystemProgram.transfer({
        fromPubkey: args.signer,
        toPubkey: args.owner,
        lamports: 0,
      }),
    ],
  };
}

export function buildDeviceSignerReclaimInstruction(args: {
  owner: PublicKey;
  signer: PublicKey;
  balanceLamports: number;
}): TransactionInstruction | null {
  if (!Number.isSafeInteger(args.balanceLamports) || args.balanceLamports < 0) {
    throw new Error("device signer balance is invalid");
  }
  return args.balanceLamports === 0
    ? null
    : SystemProgram.transfer({
        fromPubkey: args.signer,
        toPubkey: args.owner,
        lamports: args.balanceLamports,
      });
}
