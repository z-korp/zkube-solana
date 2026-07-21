import { createHash } from "node:crypto";

import { Connection, PublicKey, type Commitment } from "@solana/web3.js";

import {
  PROTOCOL_ACCOUNT_VERSION,
  activeRunPda,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";

export const MAGICBLOCK_DEVNET_ROUTER_RPC =
  "https://devnet-router.magicblock.app/";

const ACTIVE_RUN_DISCRIMINATOR = createHash("sha256")
  .update("account:ActiveRun")
  .digest()
  .subarray(0, 8);

export interface DelegationStatus {
  isDelegated: boolean;
  fqdn?: string;
  delegationRecord?: {
    authority: string;
    owner: string;
    delegationSlot: number;
    lamports: number;
  };
}

export async function getDelegationStatus(
  account: PublicKey,
  endpoint = MAGICBLOCK_DEVNET_ROUTER_RPC,
  fetcher: typeof fetch = fetch,
): Promise<DelegationStatus> {
  const router = normalizedRpcEndpoint(endpoint, "MagicBlock Router");
  const response = await fetcher(router, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  if (!response.ok) {
    throw new Error(`MagicBlock Router returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) {
    throw new Error("MagicBlock Router returned malformed JSON-RPC data");
  }
  if (isRecord(body.error)) {
    const message = typeof body.error.message === "string"
      ? body.error.message
      : "unknown Router error";
    throw new Error(`MagicBlock Router getDelegationStatus failed: ${message}`);
  }
  return parseDelegationStatus(body.result);
}

export async function resolveEphemeralConnectionForPlan(args: {
  plan: KeeperInstructionPlan;
  programId: PublicKey;
  routerEndpoint?: string;
  commitment?: Commitment;
  fetcher?: typeof fetch;
  connectionFactory?: (endpoint: string) => Connection;
}): Promise<Connection> {
  if (args.plan.operation !== "force_finish_deadline" &&
      args.plan.operation !== "commit_run") {
    throw new Error("keeper rejects ER routing for a base-layer operation");
  }
  const account = activeRunForPlan(args.plan);
  const status = await getDelegationStatus(account, args.routerEndpoint, args.fetcher);
  if (!status.isDelegated || !status.fqdn) {
    throw new Error("Router did not resolve the ActiveRun to an Ephemeral Rollup");
  }
  if (status.delegationRecord?.owner !== args.programId.toBase58()) {
    throw new Error("delegation record owner does not match the zKube program");
  }
  const commitment = args.commitment ?? "confirmed";
  const connection = args.connectionFactory?.(status.fqdn) ??
    new Connection(status.fqdn, commitment);
  const info = await connection.getAccountInfo(account, commitment);
  if (!info || !info.owner.equals(args.programId) || info.executable ||
      info.data.length < 9 || info.data.length >= 10_240 ||
      !info.data.subarray(0, 8).equals(ACTIVE_RUN_DISCRIMINATOR) ||
      info.data[8] !== PROTOCOL_ACCOUNT_VERSION) {
    throw new Error("Router-resolved ActiveRun is missing or malformed on the ER");
  }
  return connection;
}

export function activeRunForPlan(plan: KeeperInstructionPlan): PublicKey {
  const owner = plan.context?.owner;
  const runId = plan.context?.runId;
  if (!owner || runId === undefined) {
    throw new Error("ER keeper plan is missing its ActiveRun identity");
  }
  return activeRunPda(owner, runId);
}

function parseDelegationStatus(value: unknown): DelegationStatus {
  if (!isRecord(value) || typeof value.isDelegated !== "boolean") {
    throw new Error("MagicBlock Router result is missing isDelegated");
  }
  const fqdn = typeof value.fqdn === "string"
    ? normalizedRpcEndpoint(value.fqdn, "Ephemeral Rollup")
    : undefined;
  const raw = isRecord(value.delegationRecord) ? value.delegationRecord : undefined;
  const delegationRecord = raw ? {
    authority: publicKeyString(raw.authority, "delegation authority"),
    owner: publicKeyString(raw.owner, "delegation owner"),
    delegationSlot: nonNegativeSafeInteger(raw.delegationSlot, "delegation slot"),
    lamports: nonNegativeSafeInteger(raw.lamports, "delegation lamports"),
  } : undefined;
  return {
    isDelegated: value.isDelegated,
    ...(fqdn ? { fqdn } : {}),
    ...(delegationRecord ? { delegationRecord } : {}),
  };
}

function normalizedRpcEndpoint(value: string, label: string): string {
  const endpoint = new URL(value);
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new Error(`${label} RPC must use HTTPS except on localhost`);
  }
  return endpoint.toString();
}

function publicKeyString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${label} is not a Solana address`);
  }
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
