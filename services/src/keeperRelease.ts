import { createHash } from "node:crypto";

import { ZKUBE_PROGRAM_ID } from "./arcadeChain.js";
import { SESSION_KEYS_PROGRAM_ID } from "./sessionCleanup.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CANONICAL_KEEPER = "6JuZiVic8yUipamYyzWvVUcTdD8kbpdpv79CBGjm4XTg";

export const KEEPER_RELEASE_POLICY = {
  schema: "zkube-v4-keeper-release",
  schemaVersion: 1,
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
  programId: ZKUBE_PROGRAM_ID.toBase58(),
  sessionKeysProgramId: SESSION_KEYS_PROGRAM_ID.toBase58(),
  keeper: CANONICAL_KEEPER,
  maximumWritesPerPass: 8,
  maximumExpiredSessionClosuresPerPass: 2,
  maximumSpendLamportsPerPass: 50_000_000,
  reserveFloorLamports: 100_000_000,
  allowlist: [
    "consume_campaign_run",
    "consume_arena_run",
    "consume_practice_run",
    "expire_stuck_arena_entry",
    "finalize_arena_daily",
    "funded_rollup_arena_to_weekly",
    "finalize_weekly_jackpot",
    "open_weekly_jackpot",
    "open_arena_daily",
    "sync_daily_finish",
    "sync_weekly_finish",
    "cleanup_resolved_run",
    "close_arena_player",
    "close_weekly_player",
    "revoke_session_v2",
  ],
  denied: [
    "deploy_or_upgrade",
    "initialize_or_bootstrap",
    "governance",
    "declare_arena_incident",
    "refund_stuck_arena_entry",
    "withdraw_operator_revenue",
    "mainnet",
  ],
} as const;

export function keeperReleaseRecord(
  deployedProgramDataSha256: string,
  keeperImageDigest: string,
  rulesVersion: number,
) {
  if (!/^[0-9a-f]{64}$/.test(deployedProgramDataSha256)) {
    throw new Error("deployed ProgramData SHA-256 must be lowercase hex");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(keeperImageDigest)) {
    throw new Error("keeper image digest must be sha256:<lowercase hex>");
  }
  if (!Number.isSafeInteger(rulesVersion) || rulesVersion < 1 || rulesVersion > 0xffff_ffff) {
    throw new Error("rules version must be a positive u32");
  }
  const record = { ...KEEPER_RELEASE_POLICY, deployedProgramDataSha256, keeperImageDigest, rulesVersion };
  const canonical = JSON.stringify(sortJson(record));
  return {
    record,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}
