import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../constants";

export interface RunAddresses {
  runShell: PublicKey;
  activeRun: PublicKey;
  runReceipt: PublicKey;
}

export function deriveProtocolConfigPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("protocol")], programId);
}

export function deriveTreasuryLedgerPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("treasury_ledger")], programId);
}

export function deriveYieldPolicyPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("yield_policy")], programId);
}

export function deriveGovernanceProposalPda(
  proposalId: bigint,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("governance"), u64le(proposalId)], programId);
}

export function derivePlayerProfilePda(owner: PublicKey, programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("player"), owner.toBuffer()], programId);
}

export function deriveCampaignProgressPda(owner: PublicKey, programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("campaign"), owner.toBuffer()], programId);
}

export function deriveMapCatalogPda(
  contentVersion: number,
  mapId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(contentVersion, 0, 0xffff_ffff, "contentVersion");
  assertInteger(mapId, 1, 10, "mapId");
  return derive(
    [Buffer.from("map"), u32le(contentVersion), Buffer.from([mapId])],
    programId,
  );
}

export function deriveProgressCatalogPda(
  progressVersion: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(progressVersion, 1, 0xffff_ffff, "progressVersion");
  return derive([Buffer.from("progress_catalog"), u32le(progressVersion)], programId);
}

export function deriveQuestClaimsPda(
  owner: PublicKey,
  progressVersion: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(progressVersion, 1, 0xffff_ffff, "progressVersion");
  return derive(
    [Buffer.from("quest_claims"), owner.toBuffer(), u32le(progressVersion)],
    programId,
  );
}

export function deriveSponsorAllowancePda(
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("sponsor_allowance"), owner.toBuffer()], programId);
}

export function deriveDailyChallengePda(
  dayId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(dayId, 0, 0xffff_ffff, "dayId");
  return derive([Buffer.from("daily"), u32le(dayId)], programId);
}

export function deriveDailyVaultPda(
  dayId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(dayId, 0, 0xffff_ffff, "dayId");
  return derive([Buffer.from("daily_vault"), u32le(dayId)], programId);
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

export function deriveRunAddresses(
  owner: PublicKey,
  runId: bigint,
  programId = ZKUBE_PROGRAM_ID,
): RunAddresses {
  const encodedRunId = u64le(runId);
  return {
    runShell: derive([Buffer.from("run"), owner.toBuffer(), encodedRunId], programId),
    activeRun: derive(
      [Buffer.from("run"), Buffer.from("active"), owner.toBuffer(), encodedRunId],
      programId,
    ),
    runReceipt: derive([Buffer.from("receipt"), owner.toBuffer(), encodedRunId], programId),
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
