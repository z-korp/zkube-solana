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
import { zkubeProgram, type TransactionPlan } from "./program.js";
import type { WalletLike } from "./readOnlyWallet.js";
import BN from "bn.js";
export const LAUNCH_DAILY_SEED_LAMPORTS = 1_000_000_000;

export const CADENCE_FUNDING_SEED_LAMPORTS = 500_000_000;
const U64_MAX = (1n << 64n) - 1n;

export type PrizePoolKind = "daily";

export interface ProtocolInitialization {
  teamDestination: PublicKey;
  replayDomain: Uint8Array;
}

export async function buildInitializeProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
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

/** One account-creation transaction per cadence keeps every plan packet-safe. */
export async function buildPrepareLaunchPeriodPlans(args: {
  connection: Connection;
  authority: WalletLike;
  dayId: number;
}): Promise<TransactionPlan[]> {
  assertU32(args.dayId, "dayId");
  const program = zkubeProgram(args.connection, args.authority);
  const plans: TransactionPlan[] = [];
  for (const dayId of [args.dayId, args.dayId + 1]) {
    assertU32(dayId, "dayId");
    const instruction = await program.methods
      .prepareArenaDaily(dayId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arenaDaily: deriveArenaDailyPda(dayId),
        cadenceFunding: deriveCadenceFundingPda(),
        caller: args.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    plans.push(
      basePlan(
        `Prepare Daily ${dayId}`,
            args.authority.publicKey,
        [instruction],
      ),
    );
  }
  return plans;
}

/**
 * The first funding, unpause, and current Daily activation share one
 * transaction. Any failed instruction rolls the entire launch back.
 */
export async function buildAtomicArcadeLaunchPlan(args: {
  connection: Connection;
  authority: WalletLike;
  dayId: number;
}): Promise<TransactionPlan> {
  assertU32(args.dayId, "dayId");
  const program = zkubeProgram(args.connection, args.authority);
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
  const activateDaily = await program.methods
    .activateArenaDaily()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
      caller: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    "Atomically seed 1 SOL and launch Arcade",
    args.authority.publicKey,
    [seed, unpause, activateDaily],
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
