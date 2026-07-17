// @vitest-environment node

import {
  Keypair,
  SystemProgram,
  type AccountInfo,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  assertDeviceSignerCanPay,
  DEVICE_SESSION_RENEWAL_ERROR_CODE,
  requiredDeviceSignerBalance,
  validateDeviceSignerFunding,
} from "./deviceSessionFunding";

const RENT_FLOOR = 890_880;

describe("device session funding", () => {
  it("requires the rent floor plus both launch and settlement fees", () => {
    expect(requiredDeviceSignerBalance(RENT_FLOOR)).toBe(900_880);
    expect(
      validateDeviceSignerFunding({
        info: systemAccount(900_880),
        rentFloorLamports: RENT_FLOOR,
      }),
    ).toBe("ready");
    expect(
      validateDeviceSignerFunding({
        info: systemAccount(900_879),
        rentFloorLamports: RENT_FLOOR,
      }),
    ).toBe("needsRenewal");
  });

  it("keeps a missing drained signer renewable", () => {
    expect(
      validateDeviceSignerFunding({
        info: null,
        rentFloorLamports: RENT_FLOOR,
      }),
    ).toBe("needsRenewal");
  });

  it("rejects a signer address with a non-System account layout", () => {
    expect(() =>
      validateDeviceSignerFunding({
        info: {
          ...systemAccount(1_000_000),
          owner: Keypair.generate().publicKey,
        },
        rentFloorLamports: RENT_FLOOR,
      }),
    ).toThrow("invalid account layout");
  });

  it("preflights the exact transaction fee and settlement reserve", () => {
    expect(() =>
      assertDeviceSignerCanPay({
        balanceLamports: 900_880,
        rentFloorLamports: RENT_FLOOR,
        transactionFeeLamports: 5_000,
        postFeeReserveLamports: 5_000,
      }),
    ).not.toThrow();
    expect(() =>
      assertDeviceSignerCanPay({
        balanceLamports: 900_879,
        rentFloorLamports: RENT_FLOOR,
        transactionFeeLamports: 5_000,
        postFeeReserveLamports: 5_000,
      }),
    ).toThrow(DEVICE_SESSION_RENEWAL_ERROR_CODE);
  });
});

function systemAccount(lamports: number): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(0),
    executable: false,
    lamports,
    owner: SystemProgram.programId,
    rentEpoch: 0,
  };
}
