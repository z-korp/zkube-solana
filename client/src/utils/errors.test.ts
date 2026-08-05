// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  classifyWalletError,
  isWalletRejection,
  type WalletErrorKind,
} from "./errors";

describe("wallet error taxonomy", () => {
  it.each([
    [
      "local-network-access",
      mwaError(
        "ERROR_LOOPBACK_ACCESS_BLOCKED",
        "Local Network Access permission denied",
      ),
    ],
    [
      "wallet-not-found",
      mwaError(
        "ERROR_WALLET_NOT_FOUND",
        "Found no installed wallet that supports the mobile wallet protocol.",
      ),
    ],
    [
      "association-failure",
      mwaError("ERROR_ASSOCIATION_CANCELLED", "Wallet connection timed out"),
    ],
    [
      "association-failure",
      mwaError(
        "ERROR_SESSION_TIMEOUT",
        "Failed to connect to the wallet websocket at ws://localhost:54321.",
      ),
    ],
    [
      "unsupported-sign-only-v0",
      new Error(
        "Example Wallet cannot sign versioned transactions without submitting them.",
      ),
    ],
    [
      "account-mismatch",
      new Error("Wallet did not sign with the connected account"),
    ],
    [
      "session-expired",
      new Error(
        "The zKube device session expired. Renew it before continuing.",
      ),
    ],
    [
      // web3.js 1.98.4 wraps the agave `sendTransaction` preflight failure for
      // an owner whose address holds no lamports.
      "insufficient-funds",
      new Error(
        "Simulation failed. \nMessage: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.. \nCatch the `SendTransactionError` and call `getLogs()` on it for full details.",
      ),
    ],
    [
      // The same shortfall once the owner can pay the fee but not the transfers,
      // reported through the System program's short-debit log.
      "insufficient-funds",
      new Error(
        'Enable zKube device session simulation failed: {"InstructionError":[2,{"Custom":1}]} (Program 11111111111111111111111111111111 invoke [1] · Transfer: insufficient lamports 999995000, need 2000000000 · Program 11111111111111111111111111111111 failed: custom program error: 0x1)',
      ),
    ],
    [
      "insufficient-funds",
      new Error(
        "Simulation failed. \nMessage: Transaction simulation failed: Insufficient funds for fee. ",
      ),
    ],
  ] satisfies ReadonlyArray<readonly [WalletErrorKind, Error]>)(
    "classifies %s from dependency or wallet-boundary evidence",
    (kind, cause) => {
      expect(classifyWalletError(wrapped(cause))).toMatchObject({
        kind,
      });
    },
  );

  it("distinguishes the pinned association timeout from user cancellation", () => {
    const cancelled = mwaError(
      "ERROR_ASSOCIATION_CANCELLED",
      "Wallet connection cancelled by user",
    );

    expect(classifyWalletError(wrapped(cancelled))).toMatchObject({
      kind: "user-rejection",
      sourceCode: "ERROR_ASSOCIATION_CANCELLED",
    });
    expect(isWalletRejection(wrapped(cancelled))).toBe(true);
  });

  it("preserves legacy rejection matching for untyped wallet errors", () => {
    expect(isWalletRejection(new Error("User declined the request"))).toBe(
      true,
    );
    expect(
      classifyWalletError(new Error("User declined the request")).kind,
    ).toBe("user-rejection");
  });

  it("does not read an unrelated program failure as a funding shortfall", () => {
    expect(
      classifyWalletError(
        new Error(
          'Enable zKube device session simulation failed: {"InstructionError":[2,{"Custom":6002}]} (Program log: AnchorError occurred · Program log: Error Code: RunAlreadyActive · Program failed: custom program error: 0x1772)',
        ),
      ).kind,
    ).toBe("unknown");
  });

  it("does not infer Local Network Access denial from an ambiguous failure", () => {
    expect(
      classifyWalletError(new TypeError("Failed to fetch wallet endpoint")),
    ).toEqual({
      kind: "unknown",
      message: "Failed to fetch wallet endpoint",
    });
  });

  it("requires the pinned code and exact denial message for LNA guidance", () => {
    expect(
      classifyWalletError(
        wrapped(
          mwaError(
            "ERROR_LOOPBACK_ACCESS_BLOCKED",
            "An arbitrary loopback failure",
          ),
        ),
      ),
    ).toMatchObject({
      kind: "association-failure",
      sourceCode: "ERROR_LOOPBACK_ACCESS_BLOCKED",
    });
    expect(
      classifyWalletError(
        wrapped(
          mwaError(
            "ERROR_LOOPBACK_ACCESS_BLOCKED",
            "Local Network Access permission unknown",
          ),
        ),
      ),
    ).toMatchObject({
      kind: "association-failure",
      sourceCode: "ERROR_LOOPBACK_ACCESS_BLOCKED",
    });
    expect(
      classifyWalletError(new Error("Local Network Access permission denied"))
        .kind,
    ).toBe("unknown");
  });

  it.each([
    "ERROR_ASSOCIATION_PORT_OUT_OF_RANGE",
    "ERROR_FORBIDDEN_WALLET_BASE_URL",
    "ERROR_INVALID_PROTOCOL_VERSION",
    "ERROR_SECURE_CONTEXT_REQUIRED",
    "ERROR_SESSION_CLOSED",
    "ERROR_SESSION_TIMEOUT",
  ])("grounds pinned browser association code %s", (code) => {
    expect(
      classifyWalletError(wrapped(mwaError(code, "Association failed"))),
    ).toMatchObject({
      kind: "association-failure",
      sourceCode: code,
    });
  });
});

function mwaError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    name: "SolanaMobileWalletAdapterError",
    code,
  });
}

function wrapped(cause: Error): Error {
  return Object.assign(new Error(cause.message), { cause });
}
