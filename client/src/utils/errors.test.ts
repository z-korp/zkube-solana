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
