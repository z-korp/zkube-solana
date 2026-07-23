import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  deriveArcadeArchivePda,
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveProtocolConfigPda,
  deriveWeeklyJackpotPda,
} from "./pdas.js";
import { availablePoolLamports } from "./dailyClient.js";
import { fetchPlayerLabels } from "./playerLabelClient.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  MONDAY_EPOCH_DAY_ID,
  SECONDS_PER_DAY,
  WEEK_DAYS,
} from "./protocolVersions.generated.js";
import {
  coreWeeklyMetricLabels,
  initializeZkubeCore,
  WEEKLY_METRIC_LABELS,
} from "../core/zkubeCore.js";

export type WeeklyStatus = "funding" | "open" | "finalized" | "unknown";

export interface WeeklyLeaderboardEntryView {
  player: PublicKey;
  playerName: string | null;
  daily: PublicKey;
  runId: bigint;
  value: bigint;
  score: number;
  finalizedAt: number;
  replayHash: Uint8Array;
}

export interface WeeklyView {
  address: PublicKey;
  weeklyId: number;
  qualificationStartDay: number;
  status: WeeklyStatus;
  opensAt: number;
  closesAt: number;
  finalizedAt: number;
  activePotLamports: bigint;
  followingWeeklyLamports: bigint | null;
  participants: number;
  rulesHash: Uint8Array;
  metricLabels: readonly [string, string, string];
  boards: readonly [
    WeeklyLeaderboardEntryView[],
    WeeklyLeaderboardEntryView[],
    WeeklyLeaderboardEntryView[],
  ];
  /** Compatibility projection for the current full-run board. */
  leaderboard: WeeklyLeaderboardEntryView[];
}

export function currentWeeklyId(nowUnix = Math.floor(Date.now() / 1_000)): number {
  const dayId = Math.max(0, Math.floor(nowUnix / SECONDS_PER_DAY));
  return Math.max(
    0,
    Math.floor((dayId - MONDAY_EPOCH_DAY_ID) / WEEK_DAYS),
  );
}

export function weekStartDay(weeklyId: number): number {
  if (!Number.isInteger(weeklyId) || weeklyId < 0) {
    throw new Error("weeklyId is out of range");
  }
  return MONDAY_EPOCH_DAY_ID + weeklyId * WEEK_DAYS;
}

export async function fetchWeeklyView(args: {
  connection: Connection;
  wallet: WalletLike;
  weeklyId?: number;
}): Promise<WeeklyView | null> {
  const weeklyId = args.weeklyId ?? currentWeeklyId();
  const program = zkubeProgram(args.connection, args.wallet);
  const address = deriveWeeklyJackpotPda(weeklyId);
  const [challenge, following] = await Promise.all([
    program.account.weeklyJackpot.fetchNullable(address),
    program.account.weeklyJackpot.fetchNullable(
      deriveWeeklyJackpotPda(weeklyId + 1),
    ),
  ]);
  if (!challenge) return null;

  const decodedBoards = [
    challenge.comboEntries,
    challenge.actionEntries,
    challenge.runEntries,
  ] as const;
  const owners = new Map<string, PublicKey>();
  for (const board of decodedBoards) {
    for (const entry of board) owners.set(entry.player.toBase58(), entry.player);
  }
  const labels = await fetchPlayerLabels({
    connection: args.connection,
    wallet: args.wallet,
    owners: [...owners.values()],
  }).catch(() => []);
  const names = new Map(
    labels.map((label) => [label.owner.toBase58(), label.displayName]),
  );
  const mapBoard = (board: (typeof decodedBoards)[number]) =>
    board.map((entry) => {
      const value = BigInt(entry.value.toString());
      return {
        player: entry.player,
        playerName: names.get(entry.player.toBase58()) ?? null,
        daily: entry.daily,
        runId: BigInt(entry.runId.toString()),
        value,
        score: Number(value),
        finalizedAt: Number(entry.finalizedAt),
        replayHash: Uint8Array.from(entry.replayHash),
      };
    });
  const boards: WeeklyView["boards"] = [
    mapBoard(decodedBoards[0]),
    mapBoard(decodedBoards[1]),
    mapBoard(decodedBoards[2]),
  ];
  const rulesHash = Uint8Array.from(challenge.rulesHash);
  const decodedMetricLabels = challenge.metrics.map((metric) => {
    const tag = weeklyMetricTag(metric);
    return WEEKLY_METRIC_LABELS[tag];
  }) as [string, string, string];
  await initializeZkubeCore();
  const canonicalMetricLabels = coreWeeklyMetricLabels(weeklyId, rulesHash);
  if (
    canonicalMetricLabels.some(
      (label, index) => label !== decodedMetricLabels[index],
    )
  ) {
    throw new Error("Weekly metric selection does not match zkube-core");
  }
  const decodedWeeklyId = Number(challenge.weekId);
  if (decodedWeeklyId !== weeklyId) {
    throw new Error("Weekly account cadence does not match its PDA");
  }
  const qualificationStartDay = Number(challenge.qualificationStartDay);
  weeklyQualificationDays(decodedWeeklyId, qualificationStartDay);

  return {
    address,
    weeklyId: decodedWeeklyId,
    qualificationStartDay,
    status: parseWeeklyStatus(challenge.status),
    opensAt: Number(challenge.opensAt),
    closesAt: Number(challenge.closesAt),
    finalizedAt: Number(challenge.finalizedAt),
    activePotLamports: availablePoolLamports(challenge.ledger),
    followingWeeklyLamports: following
      ? availablePoolLamports(following.ledger)
      : null,
    participants: owners.size,
    rulesHash,
    metricLabels: canonicalMetricLabels,
    boards,
    leaderboard: boards[2],
  };
}

export async function buildOpenWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weeklyId: number;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.connection, args.wallet);
  const config = await program.account.arcadeConfig.fetch(
    deriveArcadeConfigPda(),
  );
  const instruction = await program.methods
    .prepareWeeklyJackpot(args.weeklyId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arcadeArchive: deriveArcadeArchivePda(),
      dailyRulesCatalog: config.rulesCatalog,
      weeklyJackpot: deriveWeeklyJackpotPda(args.weeklyId),
      payer: args.payer ?? args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan(
    "Prepare Weekly jackpot",
    args.connection,
    args.payer ?? args.wallet.publicKey,
    instruction,
  );
}

export async function buildActivateWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.activateWeeklyJackpot()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyJackpot: args.weekly.address,
      caller: args.wallet.publicKey,
    })
    .instruction();
  return plan(
    "Activate Weekly jackpot",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

export async function buildFinalizeWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const recipients = new Map<string, PublicKey>();
  for (const board of args.weekly.boards) {
    for (const entry of board.slice(0, 3).filter((entry) => entry.value > 0n)) {
      recipients.set(entry.player.toBase58(), entry.player);
    }
  }
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.finalizeWeeklyJackpot()
    .accountsPartial({
      weeklyJackpot: args.weekly.address,
      followingWeekly: deriveWeeklyJackpotPda(args.weekly.weeklyId + 1),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(
      [
        ...weeklyQualificationDays(
          args.weekly.weeklyId,
          args.weekly.qualificationStartDay,
        ).map((dayId) => ({
          pubkey: deriveArenaDailyPda(dayId),
          isSigner: false,
          isWritable: false,
        })),
        ...[...recipients.values()].map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: true,
        })),
      ],
    )
    .instruction();
  return plan(
    "Push Weekly jackpot",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

function weeklyQualificationDays(
  weeklyId: number,
  qualificationStartDay: number,
): number[] {
  const first = weekStartDay(weeklyId);
  const last = first + WEEK_DAYS - 1;
  if (
    !Number.isInteger(qualificationStartDay) ||
    qualificationStartDay < first ||
    qualificationStartDay > last
  ) {
    throw new Error("Weekly qualification start is outside its calendar period");
  }
  return Array.from(
    { length: last - qualificationStartDay + 1 },
    (_, index) => qualificationStartDay + index,
  );
}

function weeklyMetricTag(metric: object): number {
  const name = Object.keys(metric)[0];
  const names = [
    "highestCombo",
    "comboScoringActions",
    "comboDerivedScore",
    "highestActionScore",
    "mostLinesSingleAction",
    "mostBlocksSingleAction",
    "totalLines",
    "totalBlocks",
    "perfectClears",
  ];
  const tag = names.indexOf(name ?? "");
  if (tag < 0) throw new Error("Weekly contains an unknown metric");
  return tag;
}

function parseWeeklyStatus(value: unknown): WeeklyStatus {
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
