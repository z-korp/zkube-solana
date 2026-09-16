import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants.js";

export interface RunAddresses {
  activeRun: PublicKey;
}

export function deriveProtocolConfigPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("protocol")], programId);
}

export function deriveArcadeConfigPda(programId = ZKUBE_PROGRAM_ID): PublicKey {
  return derive([Buffer.from("arcade")], programId);
}

export function deriveArcadeArchivePda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("arcade_archive")], programId);
}

export function deriveCadenceFundingPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("cadence_funding")], programId);
}

export function deriveOperatorRevenueVaultPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("operator_revenue")], programId);
}

export function deriveCreditVaultPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("credit_vault")], programId);
}

export function derivePlayerStatePda(
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("player"), owner.toBuffer()], programId);
}


export function deriveArenaDailyPda(
  dayId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(dayId, 0, 0xffff_ffff, "dayId");
  return derive([Buffer.from("arena_daily"), u32le(dayId)], programId);
}

export function deriveArenaBoardPda(
  daily: PublicKey,
  kind: "score" | "theme",
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive(
    [Buffer.from("arena_board"), daily.toBuffer(), Buffer.from(kind)],
    programId,
  );
}

export function deriveArenaPlayerPda(
  challenge: PublicKey,
  owner: PublicKey,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive(
    [Buffer.from("arena_player"), challenge.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function deriveRunAddresses(
  owner: PublicKey,
  runId: bigint,
  programId = ZKUBE_PROGRAM_ID,
): RunAddresses {
  const encodedRunId = u64le(runId);
  return {
    activeRun: derive(
      [
        Buffer.from("run"),
        Buffer.from("active"),
        owner.toBuffer(),
        encodedRunId,
      ],
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

function assertInteger(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} is out of range`);
  }
}
