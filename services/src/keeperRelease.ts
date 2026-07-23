import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import {
  ARENA_ENTRY_LAMPORTS,
  ENTRY_SPLIT_LAMPORTS,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  SOL_PAYOUT_UNIT_LAMPORTS,
  ZKUBE_PROGRAM_ID,
} from "./arcadeChain.js";
import { KEEPER_EXPECTED_IDL_SHA256 } from "./anchorIdlAdapter.js";
import { SESSION_KEYS_PROGRAM_ID } from "./sessionCleanup.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const REPLAY_DOMAIN_TAG = Buffer.from("zkube-replay-domain-v2\0", "utf8");

export const KEEPER_RELEASE_POLICY = {
  schema: "zkube-v4-sol-keeper-release",
  schemaVersion: 6,
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
  maximumParticipantClosuresPerPass: 2,
  recentCadenceWindow: {
    dailies: KEEPER_RECENT_DAILY_CADENCES,
    weeklies: KEEPER_RECENT_WEEKLY_CADENCES,
    seasons: KEEPER_RECENT_SEASON_CADENCES,
  },
  maximumSpendLamportsPerPass: 100_000_000,
  reserveFloorLamports: 100_000_000,
  archiveDirectory: "/data/zkube-archives",
  maximumRapidReruns: 4,
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
    "expire_unresolved_practice_run",
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
    "archive_arena_daily",
    "archive_weekly_jackpot",
    "archive_season",
    "close_arena_daily",
    "close_weekly_jackpot",
    "close_season",
    "close_arena_player",
    "close_season_player",
    "revoke_session_v2",
  ],
  materializedInstructionAllowlist: [
    "fundedPrepareArenaDaily",
    "fundedPrepareWeeklyJackpot",
    "fundedPrepareSeason",
    "activateArenaDaily",
    "activateWeeklyJackpot",
    "activateSeason",
    "forceFinishDeadline",
    "commitRun",
    "consumeCampaignRun",
    "consumeArenaRun",
    "consumePracticeRun",
    "expireUnresolvedArenaRun",
    "expireUnresolvedPracticeRun",
    "cleanupOrphanActiveRun",
    "initializeSeasonPlayer",
    "rollupArenaToSeason",
    "sealArenaSeasonRollups",
    "finalizeArenaDaily",
    "finalizeWeeklyJackpot",
    "finalizeSeason",
    "syncDailyProfile",
    "syncWeeklyProfile",
    "syncSeasonProfile",
    "archiveArenaDaily",
    "archiveWeeklyJackpot",
    "archiveSeason",
    "closeArenaDaily",
    "closeWeeklyJackpot",
    "closeSeason",
    "closeArenaPlayer",
    "closeSeasonPlayer",
    "revokeSessionV2",
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
  keeperImageReference: string;
  replayDomainHex: string;
  rulesCatalogHash: string;
  idlHash: string;
  rulesVersion: number;
  launchDayId: number;
}

/** Stable across upgrades while remaining unique to this cluster and program. */
export function canonicalDevnetReplayDomainHex(
  programId: PublicKey = ZKUBE_PROGRAM_ID,
): string {
  return createHash("sha256")
    .update(REPLAY_DOMAIN_TAG)
    .update(new PublicKey(DEVNET_GENESIS_HASH).toBuffer())
    .update(programId.toBuffer())
    .digest("hex");
}

export function keeperReleaseRecord(input: KeeperReleaseInput) {
  const programId = publicKey(input.programId, "program ID");
  const keeper = publicKey(input.keeperPublicKey, "keeper public key");
  assertHash(input.deployedProgramDataSha256, "deployed ProgramData SHA-256");
  if (!/^registry\.fly\.io\/zkube-solana-devnet-keeper:deployment-[0-9A-HJKMNP-TV-Z]{26}$/.test(
    input.keeperImageReference,
  )) {
    throw new Error("keeper image reference must be the Fly deployment tag");
  }
  assertHash(input.replayDomainHex, "replay domain");
  if (input.replayDomainHex !== canonicalDevnetReplayDomainHex(programId)) {
    throw new Error("replay domain does not match the canonical Devnet deployment domain");
  }
  assertHash(input.rulesCatalogHash, "rules catalog hash");
  assertHash(input.idlHash, "IDL hash");
  if (input.idlHash !== KEEPER_EXPECTED_IDL_SHA256) {
    throw new Error("IDL hash does not match the keeper materializer");
  }
  if (!Number.isSafeInteger(input.rulesVersion) || input.rulesVersion < 1 ||
      input.rulesVersion > 0xffff_ffff) {
    throw new Error("rules version must be a positive u32");
  }
  if (!Number.isSafeInteger(input.launchDayId) || input.launchDayId < 4 ||
      input.launchDayId > 0xffff_ffff) {
    throw new Error("launch day must be a supported u32 day");
  }
  const record = {
    ...KEEPER_RELEASE_POLICY,
    programId: programId.toBase58(),
    keeper: keeper.toBase58(),
    deployedProgramDataSha256: input.deployedProgramDataSha256,
    keeperImageReference: input.keeperImageReference,
    replayDomainHex: input.replayDomainHex,
    rulesCatalogHash: input.rulesCatalogHash,
    idlHash: input.idlHash,
    rulesVersion: input.rulesVersion,
    launchDayId: input.launchDayId,
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
