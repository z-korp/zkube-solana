import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants";

export const MAGICBLOCK_DEVNET_ROUTER_RPC =
  "https://devnet-router.magicblock.app/";

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

export interface ClosestValidator {
  identity: PublicKey;
  fqdn?: string;
}

type Fetcher = typeof fetch;

export function routerEndpoint(): string {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return (
    env?.VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC?.trim() ||
    MAGICBLOCK_DEVNET_ROUTER_RPC
  );
}

export async function getClosestValidator(
  endpoint = routerEndpoint(),
): Promise<ClosestValidator> {
  const validator = await new ConnectionMagicRouter(
    endpoint,
  ).getClosestValidator();
  return {
    identity: new PublicKey(validator.identity),
    ...(validator.fqdn ? { fqdn: normalizeEndpoint(validator.fqdn) } : {}),
  };
}

export async function getDelegationStatus(
  account: PublicKey,
  endpoint = routerEndpoint(),
  fetcher: Fetcher = fetch,
): Promise<DelegationStatus> {
  const response = await fetcher(endpoint, {
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
    throw new Error(`MagicBlock router returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) {
    throw new Error("MagicBlock router returned malformed JSON-RPC data");
  }
  if (isRecord(body.error)) {
    const message =
      typeof body.error.message === "string"
        ? body.error.message
        : JSON.stringify(body.error);
    throw new Error(`MagicBlock router getDelegationStatus failed: ${message}`);
  }
  return parseDelegationStatus(body.result);
}

export async function waitForDelegation(
  account: PublicKey,
  options: {
    endpoint?: string;
    attempts?: number;
    delayMs?: number;
    fetcher?: Fetcher;
    expectedOwnerProgram?: PublicKey;
    commitment?: Commitment;
    erConnectionFactory?: (
      endpoint: string,
    ) => Pick<Connection, "getAccountInfo">;
  } = {},
): Promise<
  Required<Pick<DelegationStatus, "isDelegated" | "fqdn">> & DelegationStatus
> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 500;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const status = await getDelegationStatus(
        account,
        options.endpoint,
        options.fetcher,
      );
      if (status.isDelegated && status.fqdn) {
        const expectedOwner = options.expectedOwnerProgram ?? ZKUBE_PROGRAM_ID;
        if (
          status.delegationRecord &&
          status.delegationRecord.owner !== expectedOwner.toBase58()
        ) {
          throw new Error(
            `Delegation record owner ${status.delegationRecord.owner} does not match ${expectedOwner.toBase58()}`,
          );
        }
        const erConnection =
          options.erConnectionFactory?.(status.fqdn) ??
          new Connection(status.fqdn, options.commitment ?? "confirmed");
        const info = await erConnection.getAccountInfo(
          account,
          options.commitment ?? "confirmed",
        );
        if (!info?.owner.equals(expectedOwner)) {
          throw new Error(
            `Delegated account ${account.toBase58()} is not owned by ${expectedOwner.toBase58()} on ${status.fqdn}`,
          );
        }
        return { ...status, isDelegated: true, fqdn: status.fqdn };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw (
    lastError ?? new Error(`MagicBlock did not delegate ${account.toBase58()}`)
  );
}

function parseDelegationStatus(value: unknown): DelegationStatus {
  if (!isRecord(value) || typeof value.isDelegated !== "boolean") {
    throw new Error("MagicBlock router result is missing isDelegated");
  }
  const fqdn =
    typeof value.fqdn === "string" ? normalizeEndpoint(value.fqdn) : undefined;
  const raw = isRecord(value.delegationRecord) ? value.delegationRecord : null;
  const delegationRecord = raw
    ? {
        authority: publicKeyString(raw.authority, "authority"),
        owner: publicKeyString(raw.owner, "owner"),
        delegationSlot: nonNegative(raw.delegationSlot, "delegationSlot"),
        lamports: nonNegative(raw.lamports, "lamports"),
      }
    : undefined;
  return {
    isDelegated: value.isDelegated,
    ...(fqdn ? { fqdn } : {}),
    ...(delegationRecord ? { delegationRecord } : {}),
  };
}

function normalizeEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error(
      `Unsupported MagicBlock endpoint protocol ${endpoint.protocol}`,
    );
  }
  return endpoint.toString();
}

function publicKeyString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Missing delegation ${label}`);
  return new PublicKey(value).toBase58();
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid delegation ${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
