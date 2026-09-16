import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";

export function deriveProtocolConfigPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("protocol")], programId);
}

export function deriveCadenceFundingPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("cadence_funding")], programId);
}

export function deriveCreditVaultPda(
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  return derive([Buffer.from("credit_vault")], programId);
}

export function deriveArenaDailyPda(
  dayId: number,
  programId = ZKUBE_PROGRAM_ID,
): PublicKey {
  assertInteger(dayId, 0, 0xffff_ffff, "dayId");
  return derive([Buffer.from("arena_daily"), u32le(dayId)], programId);
}

function derive(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u32le(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
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
