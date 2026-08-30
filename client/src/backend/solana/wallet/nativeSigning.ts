import nacl from "tweetnacl";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

import { assertBytesEqual } from "./nativeWallet";
import { verifyWalletSignedOutput } from "./walletStandard";

export function verifyNativeSignedTransaction(
  original: VersionedTransaction,
  signedBytes: Uint8Array,
  publicKey: PublicKey,
  walletName: string,
): VersionedTransaction {
  const signed = verifyWalletSignedOutput(
    original,
    signedBytes,
    publicKey,
    walletName,
  );
  if (!(signed instanceof VersionedTransaction)) {
    throw new Error("Native wallet returned a legacy transaction");
  }
  return signed;
}

export function verifyNativeMessageSignature(args: {
  readonly message: Uint8Array;
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
  readonly publicKey: PublicKey;
}): Uint8Array {
  assertBytesEqual(
    args.message,
    args.signedMessage,
    "Wallet changed the signed message",
  );
  if (args.signature.length !== nacl.sign.signatureLength) {
    throw new Error("Wallet returned an invalid Ed25519 message signature");
  }
  if (
    !nacl.sign.detached.verify(
      args.message,
      args.signature,
      args.publicKey.toBytes(),
    )
  ) {
    throw new Error("Wallet returned an invalid message signature");
  }
  return args.signature;
}
