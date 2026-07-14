import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  SOLANA_ENDPOINT,
  SOLANA_EXPECTED_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../../src/chain/constants";
import { IDL } from "../../src/chain/idl";

const DEFAULT_PAYMASTER = "CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY";
const DEFAULT_LIMIT = 100;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

interface TransactionCost {
  signature: string;
  blockTime: number | null;
  ok: boolean;
  operation: string;
  feeLamports: number;
  paymasterDeltaLamports: number;
  rentOrEscrowOutflowLamports: number;
  rentRefundedLamports: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const connection = new Connection(args.rpc, "confirmed");
  const paymaster = new PublicKey(args.paymaster);
  const genesisHash = await connection.getGenesisHash();
  if (SOLANA_EXPECTED_GENESIS_HASH && genesisHash !== SOLANA_EXPECTED_GENESIS_HASH) {
    throw new Error("cost report RPC is not the configured Devnet cluster");
  }
  const [balanceLamports, signatures] = await Promise.all([
    connection.getBalance(paymaster, "confirmed"),
    connection.getSignaturesForAddress(paymaster, { limit: args.limit }, "confirmed"),
  ]);
  const transactions: TransactionCost[] = [];
  for (const entry of signatures) {
    const transaction = await connection.getTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) continue;
    const message = transaction.transaction.message;
    const loaded = transaction.meta?.loadedAddresses;
    const accountKeys = "getAccountKeys" in message
      ? message.getAccountKeys(loaded ? { accountKeysFromLookups: loaded } : undefined)
      : null;
    const keys = accountKeys
      ? Array.from({ length: accountKeys.length }, (_, index) => accountKeys.get(index)!)
      : "accountKeys" in message
        ? message.accountKeys
        : [];
    const paymasterIndex = keys.findIndex((key) => key.equals(paymaster));
    if (paymasterIndex < 0 || !transaction.meta) continue;
    const delta =
      transaction.meta.postBalances[paymasterIndex]! -
      transaction.meta.preBalances[paymasterIndex]!;
    const fee = transaction.meta.fee;
    const instructions = message.compiledInstructions;
    const operations: string[] = [];
    for (const instruction of instructions) {
      const programId = keys[instruction.programIdIndex];
      if (!programId?.equals(ZKUBE_PROGRAM_ID)) continue;
      const data =
        typeof instruction.data === "string"
          ? decodeBase58(instruction.data)
          : Uint8Array.from(instruction.data);
      const match = IDL.instructions.find((candidate) =>
        candidate.discriminator.every((byte, index) => data[index] === byte),
      );
      if (match) operations.push(match.name);
    }
    transactions.push({
      signature: entry.signature,
      blockTime: entry.blockTime ?? null,
      ok: transaction.meta.err === null,
      operation: operations.join("+") || "magicblock_or_system",
      feeLamports: fee,
      paymasterDeltaLamports: delta,
      rentOrEscrowOutflowLamports: Math.max(0, -delta - fee),
      rentRefundedLamports: Math.max(0, delta),
    });
  }
  const successful = transactions.filter((transaction) => transaction.ok);
  const totalFeesLamports = sum(successful, "feeLamports");
  const totalPaymasterDeltaLamports = sum(successful, "paymasterDeltaLamports");
  const report = {
    schemaVersion: 1,
    event: "devnet_cost_report",
    generatedAt: new Date().toISOString(),
    cluster: "devnet",
    rpcHost: new URL(args.rpc).host,
    genesisHash,
    paymaster: paymaster.toBase58(),
    balanceLamports,
    balanceSol: formatSol(balanceLamports),
    sample: {
      requested: args.limit,
      found: transactions.length,
      successful: successful.length,
      failed: transactions.length - successful.length,
      totalFeesLamports,
      netCostLamports: -totalPaymasterDeltaLamports,
      rentOrEscrowOutflowLamports: sum(successful, "rentOrEscrowOutflowLamports"),
      rentRefundedLamports: sum(successful, "rentRefundedLamports"),
    },
    byOperation: summarizeOperations(successful),
    transactions,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(serialized);
  if (args.out) await writeFile(resolve(args.out), serialized, { mode: 0o600 });
}

function parseArgs(values: string[]): {
  rpc: string;
  paymaster: string;
  limit: number;
  out: string | null;
} {
  const value = (name: string) => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const limit = Number(value("--limit") ?? DEFAULT_LIMIT);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("--limit must be an integer between 1 and 1000");
  }
  return {
    rpc: value("--rpc") ?? process.env.ZKUBE_READ_RPC_URL ?? SOLANA_ENDPOINT,
    paymaster: value("--paymaster") ?? process.env.ZKUBE_PAYMASTER_PUBLIC_KEY ?? DEFAULT_PAYMASTER,
    limit,
    out: value("--out") ?? null,
  };
}

function sum<T extends keyof TransactionCost>(
  transactions: TransactionCost[],
  field: T,
): number {
  return transactions.reduce((total, transaction) => {
    const value = transaction[field];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function formatSol(lamports: number): string {
  const whole = Math.floor(lamports / 1_000_000_000);
  const fraction = String(lamports % 1_000_000_000).padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function summarizeOperations(transactions: TransactionCost[]): Array<{
  operation: string;
  count: number;
  averageFeeLamports: number;
  netCostLamports: number;
  rentOrEscrowOutflowLamports: number;
  rentRefundedLamports: number;
}> {
  const grouped = new Map<string, TransactionCost[]>();
  for (const transaction of transactions) {
    const group = grouped.get(transaction.operation) ?? [];
    group.push(transaction);
    grouped.set(transaction.operation, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operation, entries]) => ({
      operation,
      count: entries.length,
      averageFeeLamports: Math.round(sum(entries, "feeLamports") / entries.length),
      netCostLamports: -sum(entries, "paymasterDeltaLamports"),
      rentOrEscrowOutflowLamports: sum(entries, "rentOrEscrowOutflowLamports"),
      rentRefundedLamports: sum(entries, "rentRefundedLamports"),
    }));
}

function decodeBase58(value: string): Uint8Array {
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error("transaction contains invalid base58 instruction data");
    decoded = decoded * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  bytes.reverse();
  const leadingZeros: number[] = [];
  for (const character of value) {
    if (character !== "1") break;
    leadingZeros.push(0);
  }
  return Uint8Array.from([...leadingZeros, ...bytes]);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
