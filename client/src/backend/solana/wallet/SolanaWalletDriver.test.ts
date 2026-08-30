// @vitest-environment node

import { Effect } from "effect";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { createFakeWalletStandard } from "@/test/mocks/walletStandard";
import { createWalletStandardWallet } from "./walletStandard";
import { browserSolanaWalletDriver } from "./SolanaWalletDriver";

const BLOCKHASH = "11111111111111111111111111111111";

describe("SolanaWalletDriver", () => {
  it("keeps signing private and sign-only for v0 transactions and messages", async () => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const fake = createFakeWalletStandard({
      keypair: owner,
      signMessageEnabled: true,
    });
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);
    const driver = browserSolanaWalletDriver(() => ({
      connector: fake.connector,
      account: fake.account,
      wallet,
      standardWallet: fake.wallet,
    }));
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: device.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    transaction.sign([device]);
    const partialSignature = Uint8Array.from(transaction.signatures[0]!);

    const signed = await Effect.runPromise(driver.signTransaction(transaction));
    const signature = await Effect.runPromise(
      driver.signMessage(new Uint8Array([1, 3, 5, 7])),
    );

    expect(signed.message.serialize()).toEqual(transaction.message.serialize());
    expect(signed.signatures[0]).toEqual(partialSignature);
    expect(signature).toEqual(new Uint8Array(64).fill(2));
    expect(fake.signTransaction).toHaveBeenCalledOnce();
    expect(fake.signMessage).toHaveBeenCalledOnce();
    expect(fake.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects message mutation", async () => {
    const fake = createFakeWalletStandard({
      signMessageEnabled: true,
      signMessageOutputs: () => [
        {
          signedMessage: new Uint8Array([9]),
          signature: new Uint8Array(64),
          signatureType: "ed25519",
        },
      ],
    });
    const driver = browserSolanaWalletDriver(() => ({
      connector: fake.connector,
      account: fake.account,
      wallet: createWalletStandardWallet(fake.wallet, fake.account),
      standardWallet: fake.wallet,
    }));

    await expect(
      Effect.runPromise(driver.signMessage(new Uint8Array([1]))),
    ).rejects.toThrow("Wallet changed the signed message");
  });
});
