import {
  PublicKey,
  type Connection,
  type Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  PAYMASTER_ENDPOINT,
  SOLANA_EXPECTED_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "./constants";
import { deriveProtocolConfigPda } from "./pdas";
import { zkubeProgram } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export interface PaymasterClient {
  pubkey: PublicKey;
  submit(transaction: Uint8Array): Promise<string>;
}

const READ_ONLY_WALLET: WalletLike = {
  publicKey: ZKUBE_PROGRAM_ID,
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    void transaction;
    throw new Error("read-only paymaster verifier cannot sign");
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    void transactions;
    throw new Error("read-only paymaster verifier cannot sign");
  },
};

export async function fetchPaymasterClient(
  connection: Connection,
  endpoint = PAYMASTER_ENDPOINT,
): Promise<PaymasterClient> {
  const genesisHash = await connection.getGenesisHash();
  assertClusterIdentity(genesisHash, SOLANA_EXPECTED_GENESIS_HASH);
  const programInfo = await connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
  if (!programInfo?.executable) throw new Error("configured zkube program is missing or not executable");
  const response = await fetch(endpoint);
  const body = await response.json() as { pubkey?: string; error?: string };
  if (!response.ok || !body.pubkey) {
    throw new Error(body.error ?? "paymaster is unavailable");
  }
  const pubkey = new PublicKey(body.pubkey);
  const protocol = await zkubeProgram(connection, READ_ONLY_WALLET).account.protocolConfig
    .fetch(deriveProtocolConfigPda());
  if (Number(protocol.version) !== 1) throw new Error("protocol account version is unsupported");
  assertPaymasterIdentity(pubkey, protocol.paymaster);
  return {
    pubkey,
    async submit(transaction: Uint8Array) {
      const submitted = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction: bytesToBase64(transaction) }),
      });
      const result = await submitted.json() as { signature?: string; error?: string };
      if (!submitted.ok || !result.signature) {
        throw new Error(result.error ?? "paymaster submission failed");
      }
      return result.signature;
    },
  };
}

export function assertPaymasterIdentity(advertised: PublicKey, configured: PublicKey): void {
  if (!advertised.equals(configured)) {
    throw new Error("paymaster endpoint identity does not match on-chain protocol configuration");
  }
}

export function assertClusterIdentity(actual: string, expected: string | null): void {
  if (expected !== null && actual !== expected) {
    throw new Error("Solana RPC genesis hash does not match deployment configuration");
  }
}

export function serializeSponsoredTransaction(transaction: VersionedTransaction): Uint8Array {
  return transaction.serialize();
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
