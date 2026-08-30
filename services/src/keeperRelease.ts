import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import {
  ARENA_BOARD_CAPACITY,
  ARENA_ENTRY_LAMPORTS,
  ENTRY_SPLIT_LAMPORTS,
  KEEPER_INSTRUCTION_ALLOWLIST,
  KEEPER_RECENT_DAILY_CADENCES,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./arcadeChain.js";
import { KEEPER_EXPECTED_IDL_SHA256 } from "./anchorIdlAdapter.js";
import { SOLANA_DEVNET_GENESIS_HASH } from "./serviceReadiness.js";

export const DEVNET_GENESIS_HASH = SOLANA_DEVNET_GENESIS_HASH;

export const KEEPER_RELEASE_POLICY = {
  schema: "zkube-v5-sol-keeper-release",
  schemaVersion: 1,
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
  entryLamports: ARENA_ENTRY_LAMPORTS.toString(),
  entrySplitLamports: {
    followingDaily: ENTRY_SPLIT_LAMPORTS.followingDaily.toString(),
    operator: ENTRY_SPLIT_LAMPORTS.operator.toString(),
  },
  payoutUnitLamports: SOL_PAYOUT_UNIT_LAMPORTS.toString(),
  arenaBoardCapacity: ARENA_BOARD_CAPACITY,
  replayVersion: 2,
  maximumWritesPerPass: 6,
  maximumBoardWritesPerPass: 32,
  maximumBoardRentLamportsPerPass: 1_802_208_480,
  recentCadenceWindow: {
    dailies: KEEPER_RECENT_DAILY_CADENCES,
  },
  maximumSpendLamportsPerPass: 100_000_000,
  reserveFloorLamports: 100_000_000,
  maximumRapidReruns: 4,
  allowlist: KEEPER_INSTRUCTION_ALLOWLIST,
} as const;

export interface KeeperReleaseInput {
  programId: string;
  keeperPublicKey: string;
  deployedProgramDataSha256: string;
  keeperImageReference: string;
  idlHash: string;
  launchDayId: number;
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
  assertHash(input.idlHash, "IDL hash");
  if (input.idlHash !== KEEPER_EXPECTED_IDL_SHA256) {
    throw new Error("IDL hash does not match the keeper materializer");
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
    idlHash: input.idlHash,
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
