// @vitest-environment node

import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";
import type { Wallet } from "@wallet-standard/base";
import { describe, expect, it, vi } from "vitest";

import { describeWalletCapabilities } from "./walletDiagnostics";

describe("Wallet Standard capability diagnostics", () => {
  it("reads only public metadata without invoking wallet feature methods", () => {
    const signTransaction = vi.fn();
    const signAndSendTransaction = vi.fn();
    const wallet = {
      version: "1.0.0",
      name: "Test Wallet",
      icon: "data:image/svg+xml,<svg />",
      chains: ["solana:mainnet", "solana:devnet"],
      features: {
        "standard:connect": { version: "1.0.0", connect: vi.fn() },
        [SolanaSignTransaction]: {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction,
        },
        [SolanaSignAndSendTransaction]: {
          version: "1.0.0",
          supportedTransactionVersions: [0],
          signAndSendTransaction,
        },
      },
      accounts: [],
    } as unknown as Wallet;

    expect(describeWalletCapabilities(wallet)).toEqual({
      name: "Test Wallet",
      chains: ["solana:devnet", "solana:mainnet"],
      featureKeys: [
        "solana:signAndSendTransaction",
        "solana:signTransaction",
        "standard:connect",
      ],
      signTransaction: {
        present: true,
        supportedTransactionVersions: ["0", "legacy"],
      },
      signAndSendTransaction: {
        present: true,
        supportedTransactionVersions: ["0"],
      },
    });
    expect(signTransaction).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
});
