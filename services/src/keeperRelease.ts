import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import {
  ARENA_ENTRY_LAMPORTS,
  ENTRY_SPLIT_LAMPORTS,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./arcadeChain.js";
import { KEEPER_EXPECTED_IDL_SHA256 } from "./anchorIdlAdapter.js";
import { SESSION_KEYS_PROGRAM_ID } from "./sessionCleanup.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const KEEPER_RELEASE_POLICY = {
  schema: "zkube-v4-sol-keeper-release",
  schemaVersion: 4,
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
  sessionKeysProgramId: SESSION_KEYS_PROGRAM_ID.toBase58(),
  entryLamports: ARENA_ENTRY_LAMPORTS.toString(),
  entrySplitLamports: {
    followingDaily: ENTRY_SPLIT_LAMPORTS.followingDaily.toString(),
    followingWeekly: ENTRY_SPLIT_LAMPORTS.followingWeekly.toString(),
    followingSeason: ENTRY_SPLIT_LAMPORTS.followingSeason.toString(),
    operator: ENTRY_SPLIT_LAMPORTS.operator.toString(),
  },
  payoutUnitLamports: SOL_PAYOUT_UNIT_LAMPORTS.toString(),
  replayVersion: 2,
  maximumWritesPerPass: 8,
  maximumExpiredSessionClosuresPerPass: 2,
  recentCadenceWindow: {
    dailies: KEEPER_RECENT_DAILY_CADENCES,
    weeklies: KEEPER_RECENT_WEEKLY_CADENCES,
    seasons: KEEPER_RECENT_SEASON_CADENCES,
  },
  maximumSpendLamportsPerPass: 50_000_000,
  reserveFloorLamports: 100_000_000,
  allowlist: [
    "prepare_arena_daily",
    "prepare_weekly_jackpot",
    "prepare_season",
    "activate_arena_daily",
    "activate_weekly_jackpot",
    "activate_season",
    "force_finish_deadline",
    "commit_run",
    "consume_campaign_run",
    "consume_arena_run",
    "consume_practice_run",
    "expire_unresolved_arena_run",
    "cleanup_orphan_active_run",
    "finalize_arena_daily",
    "initialize_season_player",
    "rollup_arena_to_season",
    "seal_arena_season_rollups",
    "finalize_weekly_jackpot",
    "finalize_season",
    "sync_daily_profile",
    "sync_weekly_profile",
    "sync_season_profile",
    "revoke_session_v2",
  ],
  denied: [
    "deploy_or_upgrade",
    "initialize_or_bootstrap",
    "initial_competition_seed",
    "governance",
    "incident_or_refund",
    "manual_reimbursement",
    "withdraw_operator_revenue",
    "arbitrary_transfer_or_swap_cpi",
    "mainnet",
  ],
} as const;

export interface KeeperReleaseInput {
  programId: string;
  keeperPublicKey: string;
  deployedProgramDataSha256: string;
  keeperImageDigest: string;
  replayDomainHex: string;
  rulesHash: string;
  schemaHash: string;
  idlHash: string;
  rulesVersion: number;
}

export function keeperReleaseRecord(input: KeeperReleaseInput) {
  const programId = publicKey(input.programId, "program ID");
  const keeper = publicKey(input.keeperPublicKey, "keeper public key");
  assertHash(input.deployedProgramDataSha256, "deployed ProgramData SHA-256");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.keeperImageDigest)) {
    throw new Error("keeper image digest must be sha256:<lowercase hex>");
  }
  assertHash(input.replayDomainHex, "replay domain");
  assertHash(input.rulesHash, "rules hash");
  assertHash(input.schemaHash, "schema hash");
  assertHash(input.idlHash, "IDL hash");
  if (input.idlHash !== KEEPER_EXPECTED_IDL_SHA256) {
    throw new Error("IDL hash does not match the keeper materializer");
  }
  if (!Number.isSafeInteger(input.rulesVersion) || input.rulesVersion < 1 ||
      input.rulesVersion > 0xffff_ffff) {
    throw new Error("rules version must be a positive u32");
  }
  const record = {
    ...KEEPER_RELEASE_POLICY,
    programId: programId.toBase58(),
    keeper: keeper.toBase58(),
    deployedProgramDataSha256: input.deployedProgramDataSha256,
    keeperImageDigest: input.keeperImageDigest,
    replayDomainHex: input.replayDomainHex,
    rulesHash: input.rulesHash,
    schemaHash: input.schemaHash,
    idlHash: input.idlHash,
    rulesVersion: input.rulesVersion,
  };
  const canonical = JSON.stringify(sortJson(record));
  return {
    record,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
  };
}

function publicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a Solana public key`);
  }
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be lowercase hex`);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
