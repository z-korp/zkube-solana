import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { buildDeviceSessionRenewalInstructions, SESSION_LIFETIME_SECONDS } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { SESSION_KEYS_PROGRAM_ID, SESSION_TOKEN_V2_DISCRIMINATOR, deriveSessionTokenV2Pda } from "../../src/backend/solana/session/sessionV2";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";

export async function generateSessionRenewalFixtures() {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(1)), previous = Keypair.fromSeed(new Uint8Array(32).fill(2)), candidate = Keypair.fromSeed(new Uint8Array(32).fill(3));
  const now = 1788912000, blockhash = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
  const token = deriveSessionTokenV2Pda({ authority: owner.publicKey, sessionSigner: previous.publicKey }).sessionToken;
  const tokenData = (signer: PublicKey, validUntil: number) => {
    const expiry = Buffer.alloc(8); expiry.writeBigInt64LE(BigInt(validUntil));
    return Buffer.concat([Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR), owner.publicKey.toBuffer(), ZKUBE_PROGRAM_ID.toBuffer(), signer.toBuffer(), owner.publicKey.toBuffer(), expiry]);
  };
  const candidateToken = { address: deriveSessionTokenV2Pda({ authority: owner.publicKey, sessionSigner: candidate.publicKey }).sessionToken.toBase58(),
    owner: SESSION_KEYS_PROGRAM_ID.toBase58(), executable: false, data: tokenData(candidate.publicKey, now + SESSION_LIFETIME_SECONDS).toString("base64"), validUntil: now + SESSION_LIFETIME_SECONDS };
  const cases = [];
  for (const remaining of [-1, 0, 59, 60, 61]) for (const balance of [0, 1000000]) {
    const data = tokenData(previous.publicKey, now + remaining);
    let reads = 0;
    const connection = { commitment: "confirmed", getAccountInfo: async (address: PublicKey) => {
      if (!address.equals(token)) throw new Error("Unexpected offline token read"); reads++;
      return { data, owner: SESSION_KEYS_PROGRAM_ID, executable: false, lamports: 2000000, rentEpoch: 0 };
    } } as unknown as Connection;
    const plan = await buildDeviceSessionRenewalInstructions({ connection, owner: owner.publicKey, signer: candidate.publicKey,
      validUntil: now + SESSION_LIFETIME_SECONDS, nowUnix: now,
      previous: { sessionToken: token, signer: previous.publicKey, validUntil: now + remaining, balanceLamports: balance } });
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash,
      instructions: withPinnedWalletComputeBudget(plan.instructions) }).compileToV0Message());
    transaction.sign([owner, candidate, ...(plan.previousSignerRequired ? [previous] : [])]);
    cases.push({ remaining, balance, oldTokenReads: reads, previousSignerRequired: plan.previousSignerRequired,
      oldToken: { address: token.toBase58(), owner: SESSION_KEYS_PROGRAM_ID.toBase58(), executable: false, data: data.toString("base64") },
      instructions: plan.instructions.map(ix => ({ programId: ix.programId.toBase58(), data: Buffer.from(ix.data).toString("base64"),
        accounts: ix.keys.map(key => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable })) })),
      message: Buffer.from(transaction.message.serialize()).toString("base64"), signedTransaction: Buffer.from(transaction.serialize()).toString("base64") });
  }
  return { version: 1, inputs: { owner: owner.publicKey.toBase58(), previous: previous.publicKey.toBase58(), candidate: candidate.publicKey.toBase58(), now, blockhash }, candidateToken, cases };
}
