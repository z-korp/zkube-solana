import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants.js";

export interface RunAddresses {
  activeRun: PublicKey;
}

export function deriveProtocolConfigPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("protocol")], programId);
}

export function deriveEconomyConfigPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("economy")], programId);
}

export function deriveStarSalesLedgerPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("star_sales")], programId);
}

export function deriveDailyRulesCatalogPda(
  rulesVersion: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(rulesVersion, 1, 0xffff_ffff, "rulesVersion");
  return derive([Buffer.from("daily_rules"), u32le(rulesVersion)], programId);
}

export function derivePlayerStatePda(owner: PublicKey, programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("player"), owner.toBuffer()], programId);
}

export function derivePlayerFundingPda(
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("player_funding"), owner.toBuffer()], programId);
}

export function deriveRewardVaultPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("reward_vault")], programId);
}

export function deriveMapCatalogPda(
  contentVersion: number,
  mapId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(contentVersion, 0, 0xffff_ffff, "contentVersion");
  assertInteger(mapId, 1, 32, "mapId");
  return derive(
    [Buffer.from("map"), u32le(contentVersion), Buffer.from([mapId])],
    programId,
  );
}

export function deriveDailyChallengePda(
  dayId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(dayId, 0, 0xffff_ffff, "dayId");
  return derive([Buffer.from("daily"), u32le(dayId)], programId);
}

export function deriveDailyPlayerPda(
  challenge: PublicKey,
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive(
    [Buffer.from("daily_player"), challenge.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function deriveDailyLeaderboardPda(
  challenge: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("daily_board"), challenge.toBuffer()], programId);
}

export function deriveWeeklyChallengePda(
  weekId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(weekId, 0, 0xffff_ffff, "weekId");
  return derive([Buffer.from("weekly"), u32le(weekId)], programId);
}

export function deriveWeeklyPlayerPda(
  challenge: PublicKey,
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive(
    [Buffer.from("weekly_player"), challenge.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function deriveWeeklyLeaderboardPda(
  challenge: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("weekly_board"), challenge.toBuffer()], programId);
}

export function deriveWeeklyVaultPda(
  weekId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(weekId, 0, 0xffff_ffff, "weekId");
  return derive([Buffer.from("weekly_vault"), u32le(weekId)], programId);
}

export function deriveRunAddresses(
  owner: PublicKey,
  runId: bigint,
  programId = ZKUBE_PROGRAM_ID,
): RunAddresses {
  const encodedRunId = u64le(runId);
  return {
    activeRun: derive(
      [Buffer.from("run"), Buffer.from("active"), owner.toBuffer(), encodedRunId],
      programId,
    ),
  };
}

function derive(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u32le(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function u64le(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("runId must fit in u64");
  }
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

function assertInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} is out of range`);
  }
}
