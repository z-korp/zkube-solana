// @vitest-environment node

import { Effect } from "effect";
import nacl from "tweetnacl";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { createFakeWalletStandard } from "@/test/mocks/walletStandard";
import {
  androidMwaDriver,
  type AndroidMwaSession,
  type MwaBridgePlugin,
} from "./androidMwaWallet";
import {
  iosDeepLinkDriver,
  type DeepLinkSession,
  type IosDeepLinkTransport,
} from "./iosDeepLinkWallet";
import { decodeBase64, encodeBase64 } from "./nativeWallet";
import { browserSolanaWalletDriver } from "./SolanaWalletDriver";
import { createWalletStandardWallet } from "./walletStandard";

const BLOCKHASH = "11111111111111111111111111111111";

describe("native owner signing", () => {
  it("identity_is_sign_only_on_every_platform", async () => {
    const owner = Keypair.generate();
    const browser = createFakeWalletStandard({
      keypair: owner,
      signMessageEnabled: true,
    });
    const browserWallet = createWalletStandardWallet(
      browser.wallet,
      browser.account,
    );
    const browserDriver = browserSolanaWalletDriver(() => ({
      connector: browser.connector,
      account: browser.account,
      wallet: browserWallet,
      standardWallet: browser.wallet,
    }));

    const forbiddenAndroidSend = vi.fn();
    const bridge: MwaBridgePlugin & {
      signAndSendTransactions: typeof forbiddenAndroidSend;
    } = {
      authorize: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransactions: forbiddenAndroidSend,
      signTransactions: vi.fn(async ({ authToken, transactions }) => ({
        authToken,
        publicKey: encodeBase64(owner.publicKey.toBytes()),
        signedTransactions: transactions.map((encoded) => {
          const transaction = VersionedTransaction.deserialize(
            decodeBase64(encoded),
          );
          transaction.sign([owner]);
          return encodeBase64(transaction.serialize());
        }),
      })),
      signMessages: vi.fn(async ({ authToken, messages }) => ({
        authToken,
        publicKey: encodeBase64(owner.publicKey.toBytes()),
        signedMessages: messages.map((encoded) => {
          const message = decodeBase64(encoded);
          return {
            message: encoded,
            signature: encodeBase64(
              nacl.sign.detached(message, owner.secretKey),
            ),
          };
        }),
      })),
    };
    const androidSession: AndroidMwaSession = {
      authToken: "android-auth",
      publicKey: owner.publicKey,
    };
    const androidDriver = androidMwaDriver(bridge, androidSession);

    const forbiddenIosSend = vi.fn();
    const iosTransport: IosDeepLinkTransport & {
      signAndSendTransaction: typeof forbiddenIosSend;
    } = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransaction: forbiddenIosSend,
      signTransaction: vi.fn(async (_session, bytes) => {
        const transaction = VersionedTransaction.deserialize(bytes);
        transaction.sign([owner]);
        return transaction.serialize();
      }),
      signMessage: vi.fn(async (_session, message) => ({
        signedMessage: message,
        signature: nacl.sign.detached(message, owner.secretKey),
      })),
    };
    const iosSession: DeepLinkSession = {
      provider: {
        id: "phantom",
        name: "Phantom",
        baseUrl: "https://phantom.app/ul/v1",
        encryptionPublicKey: "phantom_encryption_public_key",
      },
      publicKey: owner.publicKey,
      dappKeyPair: nacl.box.keyPair(),
      sharedSecret: nacl.randomBytes(nacl.box.sharedKeyLength),
      walletSession: "ios-session",
    };
    const iosDriver = iosDeepLinkDriver(iosTransport, iosSession);

    for (const [platform, driver] of [
      ["browser", browserDriver],
      ["android", androidDriver],
      ["ios", iosDriver],
    ] as const) {
      const device = Keypair.generate();
      const transaction = transactionFor(owner, device);
      const partialSignature = Uint8Array.from(transaction.signatures[0]!);
      const message = new TextEncoder().encode(`zKube ${platform}`);

      const signed = await Effect.runPromise(
        driver.signTransaction(transaction),
      );
      const signature = await Effect.runPromise(driver.signMessage(message));

      expect(signed.message.version, platform).toBe(0);
      expect(signed.message.serialize(), platform).toEqual(
        transaction.message.serialize(),
      );
      expect(signed.signatures[0], platform).toEqual(partialSignature);
      expect(signature, platform).toHaveLength(64);
    }

    expect(browser.signAndSendTransaction).not.toHaveBeenCalled();
    expect(forbiddenAndroidSend).not.toHaveBeenCalled();
    expect(forbiddenIosSend).not.toHaveBeenCalled();
  });
});

function transactionFor(owner: Keypair, device: Keypair): VersionedTransaction {
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
  return transaction;
}
