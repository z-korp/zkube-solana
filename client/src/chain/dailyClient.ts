import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "./constants.js";
import {
  deriveArcadeConfigPda,
  deriveArenaBoardPda,
  deriveArenaDailyPda,
  deriveArenaPlayerPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveWeeklyJackpotPda,
} from "./pdas.js";
import {
  assertPreparedRunAddressesAvailable,
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type EndlessRulesView,
  type PreparedRunPlan,
  type TransactionPlan,
} from "./runPlan.js";
import {
  mapDailyPressureProfile,
  mapDailyScoringRule,
  type DailyPressureProfileView,
  type DailyScoringRuleView,
} from "./dailyRules.js";
import { fetchPlayerLabels } from "./playerLabelClient.js";
import type { WalletLike } from "./sessionWallet.js";

export interface DailyLeaderboardView {
  player: PublicKey;
  playerName: string | null;
  runId: bigint;
  dailyScore: number;
  dailyBonusTriggers: number;
  engineScore: number;
  moves: number;
  finalizedAttempts: number;
  score: number;
  submittedAt: number;
  replayHash: Uint8Array;
}

export interface DailyPlayerView {
  attempts: number;
  paidAttempts: number;
  finalizedAttempts: number;
  bestRunId: bigint;
  bestDailyScore: number;
  bestDailyBonusTriggers: number;
  bestEngineScore: number;
  bestMoves: number;
  bestScore: number;
  weeklyRolledUp: boolean;
  refundedAttempts: number;
  activePaidRunId: bigint;
}

export function dailyLeaderboardRank(
  entries: readonly DailyLeaderboardView[],
  index: number,
): number {
  const target = entries[index];
  if (!target) return 0;
  const firstTie = entries.findIndex(
    (entry) =>
      entry.dailyScore === target.dailyScore &&
      entry.dailyBonusTriggers === target.dailyBonusTriggers &&
      entry.submittedAt === target.submittedAt,
  );
  return firstTie + 1;
}

export type DailyStatus =
  | "draft"
  | "open"
  | "entriesClosed"
  | "finalizing"
  | "claimable"
  | "cancelled"
  | "closed"
  | "unknown";

export function parseDailyStatus(value: unknown): DailyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const status = Object.keys(value)[0] as DailyStatus | undefined;
  return status ?? "unknown";
}

export interface DailyView extends EndlessRulesView {
  economyVersion: 3;
  address: PublicKey;
  dayId: number;
  weeklyId: number;
  status: DailyStatus;
  mapId: number;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  recoveryDeadlineAt: number;
  finalizedAt: number;
  entryLamports: bigint;
  dailyPotLamports: bigint;
  retryCubeCost: bigint;
  maxPaidRetries: number;
  uniquePlayers: number;
  closedPlayers: number;
  weeklyEligiblePlayers: number;
  weeklyRollups: number;
  attemptsStarted: bigint;
  runsFinalized: bigint;
  entriesRefunded: bigint;
  rentRecipient: PublicKey;
  playerEligible: boolean;
  playerCubes: bigint;
  nextRunId: bigint;
  activeRunId: bigint;
  player: DailyPlayerView | null;
  leaderboard: DailyLeaderboardView[];
  rules: ActiveRunRulesView;
  scoringRule: DailyScoringRuleView;
  pressure: DailyPressureProfileView;
}

export function currentDailyDayId(nowUnix = Math.floor(Date.now() / 1_000)): number {
  return Math.max(0, Math.floor(nowUnix / 86_400));
}

export async function fetchDailyView(args: {
  connection: Connection;
  wallet: WalletLike;
  dayId?: number;
}): Promise<DailyView | null> {
  const dayId = args.dayId ?? currentDailyDayId();
  const program = zkubeProgram(args.connection, args.wallet);
  const address = deriveArenaDailyPda(dayId);
  const challenge = await program.account.arenaDaily.fetchNullable(address);
  if (!challenge) return null;
  const owner = args.wallet.publicKey;
  const [profile, player, board] = await Promise.all([
    program.account.playerState.fetchNullable(derivePlayerStatePda(owner)),
    program.account.arenaPlayer.fetchNullable(deriveArenaPlayerPda(address, owner)),
    program.account.arenaBoard.fetch(deriveArenaBoardPda(address)),
  ]);
  const rows = board.entries.map((entry) => ({
    player: entry.player,
    runId: BigInt(entry.runId.toString()),
    dailyScore: Number(entry.score),
    dailyBonusTriggers: Number(entry.bonusTriggers),
    engineScore: Number(entry.engineScore),
    moves: Number(entry.moves),
    finalizedAttempts: Number(entry.attempts),
    score: Number(entry.score),
    submittedAt: Number(entry.submittedAt),
    replayHash: Uint8Array.from(entry.replayHash),
  }));
  const labels = await fetchPlayerLabels({
    connection: args.connection,
    wallet: args.wallet,
    owners: rows.map((entry) => entry.player),
  }).catch(() => []);
  const names = new Map(labels.map((label) => [label.owner.toBase58(), label.displayName]));
  const pressure = mapDailyPressureProfile(challenge.pressure);
  return {
    economyVersion: 3,
    address,
    dayId: Number(challenge.dayId),
    weeklyId: Number(challenge.weekId),
    status: parseDailyStatus(challenge.status),
    mapId: Number(challenge.mapId),
    opensAt: Number(challenge.opensAt),
    entriesCloseAt: Number(challenge.entriesCloseAt),
    runsCloseAt: Number(challenge.runsCloseAt),
    settlementGraceCloseAt: Number(challenge.recoveryDeadlineAt),
    recoveryDeadlineAt: Number(challenge.recoveryDeadlineAt),
    finalizedAt: Number(challenge.finalizedAt),
    entryLamports: BigInt(challenge.terms.entryLamports.toString()),
    dailyPotLamports: BigInt(challenge.potLamports.toString()),
    retryCubeCost: 0n,
    maxPaidRetries: Number.MAX_SAFE_INTEGER,
    uniquePlayers: Number(challenge.uniquePlayers),
    closedPlayers: 0,
    weeklyEligiblePlayers: Number(challenge.weeklyEligiblePlayers),
    weeklyRollups: Number(challenge.weeklyRollups),
    attemptsStarted: BigInt(challenge.entriesPaid.toString()),
    runsFinalized: BigInt(challenge.runsFinalized.toString()),
    entriesRefunded: BigInt(challenge.entriesRefunded.toString()),
    rentRecipient: challenge.rentRecipient,
    playerEligible: Boolean(profile?.dailyEligible),
    playerCubes: 0n,
    nextRunId: profile ? BigInt(profile.nextRunId.toString()) : 0n,
    activeRunId: profile ? BigInt(profile.activeRunId.toString()) : 0n,
    player: player
      ? {
          attempts: Number(player.paidEntries),
          paidAttempts: Number(player.paidEntries),
          finalizedAttempts: Number(player.finalizedEntries),
          bestRunId: BigInt(player.bestRunId.toString()),
          bestDailyScore: Number(player.bestScore),
          bestDailyBonusTriggers: Number(player.bestBonusTriggers),
          bestEngineScore: Number(player.bestEngineScore),
          bestMoves: Number(player.bestMoves),
          bestScore: Number(player.bestScore),
          weeklyRolledUp: Boolean(player.weeklyRolledUp),
          refundedAttempts: Number(player.refundedEntries),
          activePaidRunId: BigInt(player.activePaidRunId.toString()),
        }
      : null,
    leaderboard: rows.map((entry) => ({
      ...entry,
      playerName: names.get(entry.player.toBase58()) ?? null,
    })),
    rules: mapLevelRuleSnapshot(challenge.rules),
    scoringRule: mapDailyScoringRule(challenge.scoringRule),
    pressure,
    endlessThresholds: pressure.thresholds,
    endlessScoreMultipliersX100: pressure.scoreMultipliersX100,
  };
}

export async function buildPrepareDailyRunPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  daily: DailyView;
  sessionValidUntil: number;
}): Promise<PreparedRunPlan> {
  const owner = args.ownerAuthority;
  if (!args.wallet.publicKey.equals(owner)) {
    throw new Error("Every Arena entry requires the connected owner wallet signature");
  }
  const addresses = deriveRunAddresses(owner, args.daily.nextRunId);
  await assertPreparedRunAddressesAvailable(args.connection, owner, args.daily.nextRunId, addresses);
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.enterArenaV1(
      new BN(args.daily.nextRunId.toString()),
      new BN(args.daily.entryLamports.toString()),
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      playerState: derivePlayerStatePda(owner),
      arenaDaily: args.daily.address,
      arenaPlayer: deriveArenaPlayerPda(args.daily.address, owner),
      weeklyJackpot: deriveWeeklyJackpotPda(args.daily.weeklyId),
      operatorRevenueVault: deriveOperatorRevenueVaultPda(),
      activeRun: addresses.activeRun,
      owner,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: basePlan(
      `Enter Arena · ${(Number(args.daily.entryLamports) / 1_000_000_000).toFixed(2)} SOL`,
      args.connection,
      owner,
      [instruction],
    ),
  };
}

export async function buildCommitDailyRunPlan(args: {
  owner: PublicKey;
  payerWallet: WalletLike;
  addresses: ReturnType<typeof deriveRunAddresses>;
  dailyChallenge: PublicKey;
  economyVersion?: 1 | 2 | 3;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.erConnection, args.payerWallet)
    .methods.commitRun()
    .accountsPartial({
      payer: args.payerWallet.publicKey,
      activeRun: args.addresses.activeRun,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  return erPlan("Commit Arena result", args.erConnection, args.payerWallet.publicKey, [instruction]);
}

export async function buildOpenDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  dayId?: number;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const dayId = args.dayId ?? currentDailyDayId();
  const challenge = deriveArenaDailyPda(dayId);
  const program = zkubeProgram(args.connection, args.wallet);
  const config = await program.account.arcadeConfig.fetch(deriveArcadeConfigPda());
  const instruction = await program
    .methods.openArenaDaily(dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      dailyRulesCatalog: config.rulesCatalog,
      arenaDaily: challenge,
      arenaBoard: deriveArenaBoardPda(challenge),
      payer: args.payer ?? args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Open Arena Daily", args.connection, args.payer ?? args.wallet.publicKey, [instruction]);
}

export async function buildFinalizeDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<TransactionPlan> {
  const winnerAccounts = args.daily.leaderboard.slice(0, 5).map((entry) => ({
    pubkey: entry.player,
    isSigner: false,
    isWritable: true,
  }));
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.finalizeArenaDaily()
    .accountsPartial({
      arenaDaily: args.daily.address,
      arenaBoard: deriveArenaBoardPda(args.daily.address),
      weeklyJackpot: deriveWeeklyJackpotPda(args.daily.weeklyId),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(winnerAccounts)
    .instruction();
  return basePlan("Push Arena prizes", args.connection, args.wallet.publicKey, [instruction]);
}

/** Legacy maintenance hooks intentionally return nothing: funded Dailies never cancel or close. */
export async function fetchOwnerCancelledDailyIds(): Promise<number[]> { return []; }
export async function buildRefundDailyEntryPlan(): Promise<TransactionPlan> {
  throw new Error("Stuck Arena refunds are protocol-authority recovery operations");
}
export async function fetchDailyPlayerRecords(): Promise<[]> { return []; }
export async function fetchDailyChallengeIds(): Promise<number[]> { return []; }
export async function buildCloseDailyPlayerPlan(): Promise<TransactionPlan> {
  throw new Error("Arena player records are durable");
}
export async function buildCloseDailyChallengePlan(): Promise<TransactionPlan> {
  throw new Error("Funded Arena results are durable");
}

function erPlan(label: string, connection: Connection, feePayer: PublicKey, instructions: TransactionInstruction[], signers: Keypair[] = []): TransactionPlan {
  return { layer: "magicblock-er", label, connection, transaction: new Transaction().add(...instructions), feePayer, signers };
}
function basePlan(label: string, connection: Connection, feePayer: PublicKey, instructions: TransactionInstruction[], signers: Keypair[] = []): TransactionPlan {
  return { layer: "solana-base", label, connection, transaction: new Transaction().add(...instructions), feePayer, signers };
}
