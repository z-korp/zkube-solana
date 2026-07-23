import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { availablePoolLamports } from "./dailyClient.js";
import { fetchPlayerLabels } from "./playerLabelClient.js";
import {
  deriveArcadeArchivePda,
  deriveArcadeConfigPda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveSeasonPlayerPda,
} from "./pdas.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";

import {
  MONDAY_EPOCH_DAY_ID,
  SEASON_DAYS,
  SECONDS_PER_DAY,
} from "./protocolVersions.generated.js";

export type SeasonStatus = "funding" | "open" | "finalized" | "unknown";

export interface DailySeasonResultView {
  dayId: number;
  points: number;
  rank: number;
  recordedAt: number;
}

export interface SeasonPlayerView {
  player: PublicKey;
  points: number;
  resultCount: number;
  results: DailySeasonResultView[];
  finalCountedAt: number;
}

export interface SeasonLeaderboardEntryView {
  player: PublicKey;
  playerName: string | null;
  points: number;
  finalizedAt: number;
}

export interface SeasonView {
  address: PublicKey;
  seasonId: number;
  qualificationStartDay: number;
  status: SeasonStatus;
  opensAt: number;
  closesAt: number;
  finalizedAt: number;
  activePotLamports: bigint;
  followingSeasonLamports: bigint | null;
  sealedDailies: number;
  leaderboard: SeasonLeaderboardEntryView[];
  player: SeasonPlayerView | null;
}

export function currentSeasonId(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  const dayId = Math.max(0, Math.floor(nowUnix / SECONDS_PER_DAY));
  return Math.max(0, Math.floor((dayId - MONDAY_EPOCH_DAY_ID) / SEASON_DAYS));
}

export function seasonStartDay(seasonId: number): number {
  if (!Number.isInteger(seasonId) || seasonId < 0) {
    throw new Error("seasonId is out of range");
  }
  return MONDAY_EPOCH_DAY_ID + seasonId * SEASON_DAYS;
}

export async function fetchSeasonView(args: {
  connection: Connection;
  wallet: WalletLike;
  seasonId?: number;
}): Promise<SeasonView | null> {
  const seasonId = args.seasonId ?? currentSeasonId();
  const program = zkubeProgram(args.connection, args.wallet);
  const address = deriveSeasonPda(seasonId);
  const [season, following, player] = await Promise.all([
    program.account.season.fetchNullable(address),
    program.account.season.fetchNullable(deriveSeasonPda(seasonId + 1)),
    program.account.seasonPlayer.fetchNullable(
      deriveSeasonPlayerPda(address, args.wallet.publicKey),
    ),
  ]);
  if (!season) return null;

  const labels = await fetchPlayerLabels({
    connection: args.connection,
    wallet: args.wallet,
    owners: season.entries.map((entry) => entry.player),
  }).catch(() => []);
  const names = new Map(
    labels.map((label) => [label.owner.toBase58(), label.displayName]),
  );
  const resultCount = player ? Number(player.resultCount) : 0;
  const decodedSeasonId = Number(season.seasonId);
  if (decodedSeasonId !== seasonId) {
    throw new Error("Season account cadence does not match its PDA");
  }
  const qualificationStartDay = Number(season.qualificationStartDay);
  const firstDay = seasonStartDay(decodedSeasonId);
  const lastDay = firstDay + SEASON_DAYS - 1;
  const sealedDailies = Number(season.sealedDailies);
  if (
    !Number.isInteger(qualificationStartDay) ||
    qualificationStartDay < firstDay ||
    qualificationStartDay > lastDay ||
    !Number.isInteger(sealedDailies) ||
    sealedDailies < 0 ||
    sealedDailies > lastDay - qualificationStartDay + 1
  ) {
    throw new Error("Season qualification or seal count is invalid");
  }

  return {
    address,
    seasonId: decodedSeasonId,
    qualificationStartDay,
    status: parseSeasonStatus(season.status),
    opensAt: Number(season.opensAt),
    closesAt: Number(season.closesAt),
    finalizedAt: Number(season.finalizedAt),
    activePotLamports: availablePoolLamports(season.ledger),
    followingSeasonLamports: following
      ? availablePoolLamports(following.ledger)
      : null,
    sealedDailies,
    leaderboard: season.entries.map((entry) => ({
      player: entry.player,
      playerName: names.get(entry.player.toBase58()) ?? null,
      points: Number(entry.points),
      finalizedAt: Number(entry.finalizedAt),
    })),
    player: player
      ? {
          player: player.player,
          points: Number(player.points),
          resultCount,
          results: player.results.slice(0, resultCount).map((result) => ({
            dayId: Number(result.dayId),
            points: Number(result.points),
            rank: Number(result.rank),
            recordedAt: Number(result.recordedAt),
          })),
          finalCountedAt: Number(player.finalCountedAt),
        }
      : null,
  };
}

export async function buildPrepareSeasonPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  seasonId: number;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const feePayer = args.payer ?? args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.prepareSeason(args.seasonId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arcadeArchive: deriveArcadeArchivePda(),
      season: deriveSeasonPda(args.seasonId),
      payer: feePayer,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Prepare Season", args.connection, feePayer, instruction);
}

export async function buildActivateSeasonPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  season: SeasonView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.activateSeason()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      season: args.season.address,
      caller: args.wallet.publicKey,
    })
    .instruction();
  return plan(
    "Activate Season",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

export async function buildFinalizeSeasonPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  season: SeasonView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.finalizeSeason()
    .accountsPartial({
      season: args.season.address,
      followingSeason: deriveSeasonPda(args.season.seasonId + 1),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(
      args.season.leaderboard.slice(0, 5).map((entry) => ({
        pubkey: entry.player,
        isSigner: false,
        isWritable: true,
      })),
    )
    .instruction();
  return plan(
    "Push Season prizes",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

function parseSeasonStatus(value: unknown): SeasonStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const status = Object.keys(value)[0];
  return status === "funding" || status === "open" || status === "finalized"
    ? status
    : "unknown";
}

function plan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instruction: TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}
