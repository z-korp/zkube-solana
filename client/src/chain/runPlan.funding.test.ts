// @vitest-environment node

import {
  Keypair,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { DEVICE_SESSION_RENEWAL_ERROR_CODE } from "./deviceSessionFunding";
import {
  compileWalletTransactionPlan,
  type TransactionPlan,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";

describe("run transaction funding preflight", () => {
  it("rejects a low device signer before simulation", async () => {
    const signer = Keypair.generate();
    const simulation = vi.fn();
    const connection = {
      rpcEndpoint: "https://base.example",
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
      }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      getBalance: vi.fn().mockResolvedValue(900_879),
      getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(890_880),
      simulateTransaction: simulation,
    } as unknown as Connection;
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "Prepare and delegate active run",
      connection,
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 0,
        }),
      ),
      feePayer: signer.publicKey,
      signers: [],
      postFeeRentReserveLamports: 5_000,
    };

    await expect(
      compileWalletTransactionPlan({
        transactionPlan,
        wallet: new SessionWallet(signer),
      }),
    ).rejects.toThrow(DEVICE_SESSION_RENEWAL_ERROR_CODE);
    expect(simulation).not.toHaveBeenCalled();
  });
});
