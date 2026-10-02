import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  deriveArenaDailyPda,
  deriveCadenceFundingPda,
  deriveCreditVaultPda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import { programDataAddress } from "./chainRelease.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { zkubeProgram, type TransactionPlan } from "./program.js";
import type { WalletLike } from "./readOnlyWallet.js";
import BN from "bn.js";
import { CADENCE_FUNDING_TWO_DAY_LAMPORTS } from "../../services/src/protocolVersions.generated.js";
export const LAUNCH_DAILY_SEED_LAMPORTS = 1_000_000_000;

/** Cadence funding's worst case: two overlapping Dailies with full boards. */
export const CADENCE_FUNDING_SEED_LAMPORTS = CADENCE_FUNDING_TWO_DAY_LAMPORTS;
const U64_MAX = (1n << 64n) - 1n;

export type PrizePoolKind = "daily";

export interface ProtocolInitialization {
  teamDestination: PublicKey;
  replayDomain: Uint8Array;
}

export async function buildInitializeProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
  upgradeAuthority: PublicKey;
  config: ProtocolInitialization;
}): Promise<TransactionPlan> {
  if (
    args.config.replayDomain.length !== 32 ||
    args.config.replayDomain.every((byte) => byte === 0)
  ) {
    throw new Error("replayDomain must contain 32 nonzero-domain bytes");
  }
  const destinations = [args.config.teamDestination];
  if (
    destinations.some((destination) => destination.equals(PublicKey.default)) ||
    new Set(destinations.map((destination) => destination.toBase58())).size !==
      destinations.length
  )
    throw new Error(
      "protocol destinations must be nonzero and pairwise distinct",
    );
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.initializeProtocol({
      teamDestination: args.config.teamDestination,
      replayDomain: [...args.config.replayDomain],
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      creditVault: deriveCreditVaultPda(),
      teamDestination: args.config.teamDestination,
      authority: args.authority.publicKey,
      upgradeAuthority: args.upgradeAuthority,
      program: ZKUBE_PROGRAM_ID,
      programData: programDataAddress(),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    "Initialize protocol",
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildSetArenaSuspensionPlan(args: {
  connection: Connection;
  authority: WalletLike;
  untilDay: number;
}): Promise<TransactionPlan> {
  assertU32(args.untilDay, "untilDay");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.setArenaSuspension(args.untilDay)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    `Set Arena suspension until day ${args.untilDay}`,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildSeedCadenceFundingPlan(args: {
  connection: Connection;
  authority: WalletLike;
}): Promise<TransactionPlan> {
  const cadenceSeed = SystemProgram.transfer({
    fromPubkey: args.authority.publicKey,
    toPubkey: deriveCadenceFundingPda(),
    lamports: CADENCE_FUNDING_SEED_LAMPORTS,
  });
  return basePlan(
    "Seed recyclable cadence rent",
    args.authority.publicKey,
    [cadenceSeed],
  );
}

/**
 * The launch day's Daily is prepared, seeded and the protocol unpaused in one
 * transaction: any failed instruction rolls the entire launch back. Only
 * today's Daily can be prepared, so it cannot be staged a day ahead, and a
 * Daily is open by the clock: nothing activates it.
 */
export async function buildAtomicArcadeLaunchPlan(args: {
  connection: Connection;
  authority: WalletLike;
  dayId: number;
}): Promise<TransactionPlan> {
  assertU32(args.dayId, "dayId");
  const program = zkubeProgram(args.connection, args.authority);
  const prepare = await program.methods
    .prepareArenaDaily(args.dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
      cadenceFunding: deriveCadenceFundingPda(),
      caller: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const seed = await program.methods
    .depositArenaDaily(new BN(LAUNCH_DAILY_SEED_LAMPORTS))
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const unpause = await program.methods
    .setProtocolPause(false)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    "Atomically prepare the launch Daily, seed 1 SOL and launch Arcade",
    args.authority.publicKey,
    [prepare, seed, unpause],
  );
}

/**
 * Builds one exact authority-funded prize-pool transfer. The public API is
 * constrained to the canonical Daily PDA.
 */
export async function buildDepositArenaDailyPlan(args: {
  connection: Connection;
  authority: WalletLike;
  pool: PrizePoolKind;
  cadenceId: number;
  lamports: bigint;
}): Promise<TransactionPlan> {
  assertU32(args.cadenceId, "cadenceId");
  if (args.lamports <= 0n || args.lamports > U64_MAX) {
    throw new Error("lamports must fit in a positive u64");
  }
  const program = zkubeProgram(args.connection, args.authority);
  const amount = new BN(args.lamports.toString());
  const instruction = await program.methods
    .depositArenaDaily(amount)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.cadenceId),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    `Top up ${args.pool} ${args.cadenceId} with ${args.lamports.toString()} lamports`,
    args.authority.publicKey,
    [instruction],
  );
}

function basePlan(
  label: string,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
): TransactionPlan {
  return {
    label,
    transaction: new Transaction().add(...instructions),
    feePayer,
  };
}

function assertU32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} must fit in u32`);
  }
}
