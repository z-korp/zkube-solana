import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";

export interface PublicTransaction {
  label: string;
  payer: string;
  maximumFeeLamports: number;
  maximumSpendLamports: number;
  reserveLamports: number;
  instructions: Array<{ program: string; data: string;
    accounts: Array<{ address: string; signer: boolean; writable: boolean }> }>;
}

export interface TransactionReceipt {
  transactionHash: string;
  state: "pending" | "confirmed";
  signature: string;
  raw: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function saveBundle(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}

export function publicTransaction(label: string, payer: PublicKey, transaction: Transaction,
  bounds: Pick<PublicTransaction, "maximumFeeLamports" | "maximumSpendLamports" | "reserveLamports">,
): PublicTransaction {
  return { label, payer: payer.toBase58(), ...bounds,
    instructions: transaction.instructions.map(instruction => ({
      program: instruction.programId.toBase58(), data: instruction.data.toString("base64"),
      accounts: instruction.keys.map(key => ({ address: key.pubkey.toBase58(),
        signer: key.isSigner, writable: key.isWritable })),
    })),
  };
}

export function transactionMessage(plan: PublicTransaction, blockhash: string) {
  return new TransactionMessage({ payerKey: new PublicKey(plan.payer), recentBlockhash: blockhash,
    instructions: plan.instructions.map(instruction => new TransactionInstruction({
      programId: new PublicKey(instruction.program), data: Buffer.from(instruction.data, "base64"),
      keys: instruction.accounts.map(key => ({ pubkey: new PublicKey(key.address),
        isSigner: key.signer, isWritable: key.writable })),
    })),
  }).compileToV0Message();
}

export function loadPinnedKeypair(path: string, expected: string): Keypair {
  let bytes: unknown;
  try { bytes = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Unable to read the pinned signer file"); }
  if (!Array.isArray(bytes) || bytes.length !== 64 ||
      bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("Signer file is not a 64-byte keypair");
  }
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  if (signer.publicKey.toBase58() !== expected) throw new Error("Signer differs from the approved public key");
  return signer;
}

function confirmed(status: string | null | undefined): boolean {
  return status === "confirmed" || status === "finalized";
}

export async function executeTransaction(args: {
  connection: Connection; plan: PublicTransaction; existing?: TransactionReceipt;
  loadSigner: (publicKey: string) => Keypair;
  beforeFresh?: () => Promise<void>;
  persist: (receipt: TransactionReceipt) => void;
}): Promise<TransactionReceipt> {
  const { connection, plan, persist } = args;
  const transactionHash = fingerprint(plan);
  const relay = async (receipt: TransactionReceipt): Promise<TransactionReceipt> => {
    const signature = await connection.sendRawTransaction(Buffer.from(receipt.raw, "base64"), {
      skipPreflight: false, maxRetries: 5,
    });
    if (signature !== receipt.signature) throw new Error("Relayed signature differs from the durable receipt");
    const result = await connection.confirmTransaction({ signature, blockhash: receipt.blockhash,
      lastValidBlockHeight: receipt.lastValidBlockHeight }, "confirmed");
    if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    const done = { ...receipt, state: "confirmed" as const };
    persist(done);
    return done;
  };
  if (args.existing) {
    const receipt = args.existing;
    const transaction = VersionedTransaction.deserialize(Buffer.from(receipt.raw, "base64"));
    const messageBytes = transaction.message.serialize();
    const signaturesValid = transaction.signatures.every((signature, index) => verify(null, messageBytes,
      createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"),
        transaction.message.staticAccountKeys[index]!.toBuffer()]), format: "der", type: "spki" }), signature));
    if (receipt.transactionHash !== transactionHash ||
        !Buffer.from(transaction.message.serialize()).equals(
          Buffer.from(transactionMessage(plan, receipt.blockhash).serialize())) ||
        base58(transaction.signatures[0]!) !== receipt.signature ||
        !Number.isSafeInteger(receipt.lastValidBlockHeight) || receipt.lastValidBlockHeight <= 0 ||
        !["pending", "confirmed"].includes(receipt.state) || !signaturesValid) {
      throw new Error("Receipt differs from the approved transaction");
    }
    const status = await connection.getSignatureStatus(receipt.signature, { searchTransactionHistory: true });
    if (status.value?.err) throw new Error("The recorded transaction failed; a new plan is required");
    if (confirmed(status.value?.confirmationStatus)) {
      const done = { ...receipt, state: "confirmed" as const };
      persist(done);
      return done;
    }
    if (receipt.state === "confirmed") throw new Error("Confirmed receipt is no longer visible");
    if ((await connection.isBlockhashValid(receipt.blockhash, { commitment: "confirmed" })).value) {
      return relay(receipt);
    }
    // An observed but unfinished signature is not proof that replay is safe.
    if (status.value || await connection.getBlockHeight("finalized") <= receipt.lastValidBlockHeight) {
      throw new Error("Recorded transaction has not reached a final outcome");
    }
    if ((await connection.getSignatureStatus(receipt.signature, { searchTransactionHistory: true })).value) {
      throw new Error("Recorded transaction became visible; resume its receipt before continuing");
    }
  }
  await args.beforeFresh?.();
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = transactionMessage(plan, latest.blockhash);
  const fee = (await connection.getFeeForMessage(message, "confirmed")).value;
  const payer = new PublicKey(plan.payer);
  const balance = await connection.getBalance(payer, "confirmed");
  if (fee === null || !Number.isSafeInteger(fee) || fee < 0 || fee > plan.maximumFeeLamports ||
      balance < plan.maximumSpendLamports + plan.reserveLamports) {
    throw new Error("Fee or payer reserve exceeds the approved bounds");
  }
  const transaction = new VersionedTransaction(message);
  const signerKeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  transaction.sign(signerKeys.map(key => args.loadSigner(key.toBase58())));
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: true,
    commitment: "confirmed", accounts: { encoding: "base64", addresses: [plan.payer] } });
  const remaining = simulation.value.accounts?.[0]?.lamports;
  if (simulation.value.err || remaining === undefined || !Number.isSafeInteger(remaining) ||
      remaining < plan.reserveLamports || balance - remaining > plan.maximumSpendLamports) {
    throw new Error(`Simulation failed or exceeded approved spend: ${JSON.stringify(simulation.value.err)}`);
  }
  const receipt: TransactionReceipt = { transactionHash, state: "pending",
    signature: base58(transaction.signatures[0]!), raw: Buffer.from(transaction.serialize()).toString("base64"),
    blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
  persist(receipt);
  return relay(receipt);
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let result = "";
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = "1" + result; }
  return result;
}
