import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";

import {
  deriveArcadeConfigPda,
  deriveArenaBoardPda,
  deriveArenaDailyPda,
  deriveArenaPlayerPda,
  deriveWeeklyBoardPda,
  deriveWeeklyJackpotPda,
  deriveWeeklyPlayerPdaV1,
} from "./pdas.js";
import { fetchPlayerLabels } from "./playerLabelClient.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";
import type { DailyView } from "./dailyClient.js";

export type WeeklyStatus = "open" | "finalized" | "unknown";

export interface WeeklyLeaderboardEntryView {
  player: PublicKey;
  playerName: string | null;
  score: number;
  totalBonusTriggers: number;
  earliestFinalSubmission: number;
}

export interface WeeklyView {
  address: PublicKey;
  weeklyId: number;
  status: WeeklyStatus;
  opensAt: number;
  closesAt: number;
  finalizesAt: number;
  finalizedAt: number;
  claimsCloseAt: number;
  committedSolPool: bigint;
  solClaimed: bigint;
  participants: number;
  closedPlayers: number;
  solWinnerCount: number;
  cubeWinnerCount: number;
  rentRecipient: PublicKey;
  player: { score: number; resultCount: number; solClaimed: boolean; cubesClaimed: boolean } | null;
  leaderboard: WeeklyLeaderboardEntryView[];
}

export function currentWeeklyId(nowUnix = Math.floor(Date.now() / 1_000)): number {
  return Math.max(0, Math.floor((nowUnix + 259_200) / 604_800));
}

export async function fetchWeeklyView(args: {
  connection: Connection;
  wallet: WalletLike;
  weeklyId?: number;
}): Promise<WeeklyView | null> {
  const weeklyId = args.weeklyId ?? currentWeeklyId();
  const program = zkubeProgram(args.connection, args.wallet);
  const address = deriveWeeklyJackpotPda(weeklyId);
  const challenge = await program.account.weeklyJackpot.fetchNullable(address);
  if (!challenge) return null;
  const [player, board] = await Promise.all([
    program.account.weeklyPlayer.fetchNullable(deriveWeeklyPlayerPdaV1(address, args.wallet.publicKey)),
    program.account.weeklyBoard.fetch(deriveWeeklyBoardPda(address)),
  ]);
  const rows = board.entries.map((entry) => ({
    player: entry.player,
    score: Number(entry.score),
    totalBonusTriggers: Number(entry.totalBonusTriggers),
    earliestFinalSubmission: Number(entry.earliestFinalSubmission),
  }));
  const labels = await fetchPlayerLabels({ connection: args.connection, wallet: args.wallet, owners: rows.map((row) => row.player) }).catch(() => []);
  const names = new Map(labels.map((label) => [label.owner.toBase58(), label.displayName]));
  return {
    address,
    weeklyId: Number(challenge.weekId),
    status: parseWeeklyStatus(challenge.status),
    opensAt: Number(challenge.opensAt),
    closesAt: Number(challenge.closesAt),
    finalizesAt: Number(challenge.closesAt),
    finalizedAt: Number(challenge.finalizedAt),
    claimsCloseAt: 0,
    committedSolPool: BigInt(challenge.potLamports.toString()),
    solClaimed: 0n,
    participants: Number(challenge.participants),
    closedPlayers: 0,
    solWinnerCount: Math.min(3, rows.length),
    cubeWinnerCount: 0,
    rentRecipient: challenge.rentRecipient,
    player: player ? { score: Number(player.score), resultCount: Number(player.resultCount), solClaimed: false, cubesClaimed: true } : null,
    leaderboard: rows.map((row) => ({ ...row, playerName: names.get(row.player.toBase58()) ?? null })),
  };
}

export async function buildOpenWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weeklyId: number;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const jackpot = deriveWeeklyJackpotPda(args.weeklyId);
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.openWeeklyJackpot(args.weeklyId)
    .accountsPartial({
      arcadeConfig: deriveArcadeConfigPda(),
      weeklyJackpot: jackpot,
      weeklyBoard: deriveWeeklyBoardPda(jackpot),
      payer: args.payer ?? args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Open Weekly jackpot", args.connection, args.payer ?? args.wallet.publicKey, instruction);
}

export async function buildRollupDailyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  weekly: WeeklyView;
  playerOwner?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.playerOwner ?? args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.rollupArenaToWeekly()
    .accountsPartial({
      arenaDaily: args.daily.address,
      arenaBoard: deriveArenaBoardPda(args.daily.address),
      arenaPlayer: deriveArenaPlayerPda(args.daily.address, owner),
      weeklyJackpot: args.weekly.address,
      weeklyPlayer: deriveWeeklyPlayerPdaV1(args.weekly.address, owner),
      weeklyBoard: deriveWeeklyBoardPda(args.weekly.address),
      owner,
      payer: args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Roll Arena result into Weekly", args.connection, args.wallet.publicKey, instruction);
}

export async function buildFinalizeWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const startDay = args.weekly.weeklyId * 7 - 3;
  const remaining = [
    ...Array.from({ length: 7 }, (_, offset) => ({ pubkey: deriveArenaDailyPda(startDay + offset), isSigner: false, isWritable: false })),
    ...args.weekly.leaderboard.slice(0, 3).map((entry) => ({ pubkey: entry.player, isSigner: false, isWritable: true })),
  ];
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.finalizeWeeklyJackpot()
    .accountsPartial({
      weeklyJackpot: args.weekly.address,
      weeklyBoard: deriveWeeklyBoardPda(args.weekly.address),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(remaining)
    .instruction();
  return plan("Push Weekly jackpot", args.connection, args.wallet.publicKey, instruction);
}

export async function fetchPendingDailyRollupOwners(): Promise<PublicKey[]> { return []; }
export async function fetchOwnerClaimableWeeklyIds(): Promise<number[]> { return []; }
export async function buildClaimWeeklyCubesPlan(): Promise<TransactionPlan> { throw new Error("Weekly prizes are pushed automatically"); }
export async function buildClaimWeeklySolPlan(): Promise<TransactionPlan> { throw new Error("Weekly prizes are pushed automatically"); }
export async function buildForfeitWeeklySolPlan(): Promise<TransactionPlan> { throw new Error("Weekly prizes never expire or forfeit"); }
export async function fetchWeeklyPlayerRecords(): Promise<[]> { return []; }
export async function fetchWeeklyChallengeIds(): Promise<number[]> { return []; }
export async function buildCloseWeeklyPlayerPlan(): Promise<TransactionPlan> { throw new Error("Weekly records are durable"); }
export async function buildCloseWeeklyChallengePlan(): Promise<TransactionPlan> { throw new Error("Weekly jackpots are durable"); }

function parseWeeklyStatus(value: unknown): WeeklyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const status = Object.keys(value)[0];
  return status === "open" || status === "finalized" ? status : "unknown";
}

function plan(label: string, connection: Connection, feePayer: PublicKey, instruction: import("@solana/web3.js").TransactionInstruction): TransactionPlan {
  return { layer: "solana-base", label, connection, transaction: new Transaction().add(instruction), feePayer, signers: [] };
}
