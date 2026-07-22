import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  ZKUBE_PROGRAM_ID,
} from "./constants.js";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveArenaPlayerPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveSeasonPda,
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
  seasonRolledUp: boolean;
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
  | "funding"
  | "open"
  | "finalized"
  | "unknown";

export function parseDailyStatus(value: unknown): DailyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const status = Object.keys(value)[0];
  return status === "funding" || status === "open" || status === "finalized"
    ? status
    : "unknown";
}

export interface DailyView extends EndlessRulesView {
  address: PublicKey;
  dayId: number;
  weeklyId: number;
  seasonId: number;
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
  followingDailyLamports: bigint | null;
  uniquePlayers: number;
  seasonEligiblePlayers: number;
  seasonRollups: number;
  attemptsStarted: bigint;
  runsFinalized: bigint;
  entriesExpired: bigint;
  rulesHash: Uint8Array;
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

export function practiceRunsCloseAt(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return currentDailyDayId(nowUnix) * 86_400 + 23 * 3_600 + 30 * 60;
}

export function isPracticeEntryWindowOpen(
  nowUnix = Math.floor(Date.now() / 1_000),
): boolean {
  return nowUnix < practiceRunsCloseAt(nowUnix);
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
  const [profile, player, arcadeConfig, following] = await Promise.all([
    program.account.playerState.fetchNullable(derivePlayerStatePda(owner)),
    program.account.arenaPlayer.fetchNullable(deriveArenaPlayerPda(address, owner)),
    program.account.arcadeConfig.fetch(deriveArcadeConfigPda()),
    program.account.arenaDaily.fetchNullable(deriveArenaDailyPda(dayId + 1)),
  ]);
  const rows = challenge.entries.map((entry) => ({
    player: entry.player,
    runId: BigInt(entry.runId.toString()),
    dailyScore: Number(entry.score),
    dailyBonusTriggers: 0,
    engineScore: Number(entry.score),
    moves: 0,
    finalizedAttempts: Number(entry.attempts),
    score: Number(entry.score),
    submittedAt: Number(entry.finalizedAt),
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
    address,
    dayId: Number(challenge.dayId),
    weeklyId: Number(challenge.weekId),
    seasonId: Number(challenge.seasonId),
    status: parseDailyStatus(challenge.status),
    mapId: Number(challenge.mapId),
    opensAt: Number(challenge.opensAt),
    entriesCloseAt: Number(challenge.entriesCloseAt),
    runsCloseAt: Number(challenge.runsCloseAt),
    settlementGraceCloseAt: Number(challenge.recoveryDeadlineAt),
    recoveryDeadlineAt: Number(challenge.recoveryDeadlineAt),
    finalizedAt: Number(challenge.finalizedAt),
    entryLamports: BigInt(arcadeConfig.entryLamports.toString()),
    dailyPotLamports: availablePoolLamports(challenge.ledger),
    followingDailyLamports: following
      ? availablePoolLamports(following.ledger)
      : null,
    uniquePlayers: Number(challenge.uniquePlayers),
    seasonEligiblePlayers: Number(challenge.seasonEligiblePlayers),
    seasonRollups: Number(challenge.seasonRollups),
    attemptsStarted: BigInt(challenge.entriesPaid.toString()),
    runsFinalized: BigInt(challenge.entriesScored.toString()),
    entriesExpired: BigInt(challenge.entriesExpired.toString()),
    rulesHash: Uint8Array.from(challenge.rulesHash),
    nextRunId: profile ? BigInt(profile.nextRunId.toString()) : 0n,
    activeRunId: profile ? BigInt(profile.activeRunId.toString()) : 0n,
    player: player
      ? {
          attempts: Number(player.paidEntries),
          paidAttempts: Number(player.paidEntries),
          finalizedAttempts: Number(player.resolvedEntries),
          bestRunId: BigInt(player.bestEntry.runId.toString()),
          bestDailyScore: Number(player.bestEntry.score),
          bestDailyBonusTriggers: 0,
          bestEngineScore: Number(player.bestEntry.score),
          bestMoves: 0,
          bestScore: Number(player.bestEntry.score),
          seasonRolledUp: Boolean(player.seasonRolledUp),
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
    .methods.fundedEnterArena(
      new BN(args.daily.nextRunId.toString()),
      new BN(args.daily.entryLamports.toString()),
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      playerState: derivePlayerStatePda(owner),
      currentDaily: args.daily.address,
      arenaPlayer: deriveArenaPlayerPda(args.daily.address, owner),
      currentWeekly: deriveWeeklyJackpotPda(args.daily.weeklyId),
      currentSeason: deriveSeasonPda(args.daily.seasonId),
      followingDaily: deriveArenaDailyPda(args.daily.dayId + 1),
      followingWeekly: deriveWeeklyJackpotPda(args.daily.weeklyId + 1),
      followingSeason: deriveSeasonPda(args.daily.seasonId + 1),
      operatorRevenueVault: deriveOperatorRevenueVaultPda(),
      activeRun: addresses.activeRun,
      playerFunding: derivePlayerFundingPda(owner),
      owner,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: basePlan(
      `Enter Arena · exact ${(Number(args.daily.entryLamports) / 1_000_000_000).toFixed(2)} SOL + network fee`,
      args.connection,
      owner,
      [instruction],
    ),
  };
}

/**
 * Prepares a free run against yesterday's immutable Arena rules. The device
 * signer pays the transaction fee while the narrow funded self-CPI may spend
 * only the owner's protocol-controlled rent allowance.
 */
export async function buildPreparePracticeRunPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  daily: DailyView;
  sessionValidUntil: number;
  nowUnix?: number;
}): Promise<PreparedRunPlan> {
  const owner = args.ownerAuthority;
  if (args.daily.status !== "finalized") {
    throw new Error("Practice requires yesterday's finalized Arena");
  }
  if (!isPracticeEntryWindowOpen(args.nowUnix)) {
    throw new Error(
      "Practice entry closes at 23:30 UTC so every started run has a valid on-chain window",
    );
  }
  const addresses = deriveRunAddresses(owner, args.daily.nextRunId);
  await assertPreparedRunAddressesAvailable(
    args.connection,
    owner,
    args.daily.nextRunId,
    addresses,
  );
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.fundedPreparePracticeRun(new BN(args.daily.nextRunId.toString()))
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(owner),
      arenaDaily: args.daily.address,
      activeRun: addresses.activeRun,
      playerFunding: derivePlayerFundingPda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: basePlan(
      "Prepare free Practice run",
      args.connection,
      args.wallet.publicKey,
      [instruction],
    ),
  };
}

export async function buildCommitDailyRunPlan(args: {
  owner: PublicKey;
  payerWallet: WalletLike;
  addresses: ReturnType<typeof deriveRunAddresses>;
  dailyChallenge: PublicKey;
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
    .methods.prepareArenaDaily(dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      dailyRulesCatalog: config.rulesCatalog,
      arenaDaily: challenge,
      payer: args.payer ?? args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Prepare Arena Daily", args.connection, args.payer ?? args.wallet.publicKey, [instruction]);
}

export async function buildActivateDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.activateArenaDaily()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: args.daily.address,
      caller: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    "Activate Arena Daily",
    args.connection,
    args.wallet.publicKey,
    [instruction],
  );
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
      followingDaily: deriveArenaDailyPda(args.daily.dayId + 1),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(winnerAccounts)
    .instruction();
  return basePlan("Push Arena prizes", args.connection, args.wallet.publicKey, [instruction]);
}

export async function fetchDailyPlayerRecords(): Promise<[]> { return []; }
export async function fetchDailyChallengeIds(): Promise<number[]> { return []; }
export async function buildCloseDailyPlayerPlan(): Promise<TransactionPlan> {
  throw new Error("Arena player records are durable");
}
export async function buildCloseDailyChallengePlan(): Promise<TransactionPlan> {
  throw new Error("Funded Arena results are durable");
}

export function availablePoolLamports(ledger: {
  seededLamports: { toString(): string };
  entryLamports: { toString(): string };
  rolloverInLamports: { toString(): string };
  payoutLamports: { toString(): string };
  rolloverOutLamports: { toString(): string };
}): bigint {
  return (
    BigInt(ledger.seededLamports.toString()) +
    BigInt(ledger.entryLamports.toString()) +
    BigInt(ledger.rolloverInLamports.toString()) -
    BigInt(ledger.payoutLamports.toString()) -
    BigInt(ledger.rolloverOutLamports.toString())
  );
}

function erPlan(label: string, connection: Connection, feePayer: PublicKey, instructions: TransactionInstruction[], signers: Keypair[] = []): TransactionPlan {
  return { layer: "magicblock-er", label, connection, transaction: new Transaction().add(...instructions), feePayer, signers };
}
function basePlan(label: string, connection: Connection, feePayer: PublicKey, instructions: TransactionInstruction[], signers: Keypair[] = []): TransactionPlan {
  return { layer: "solana-base", label, connection, transaction: new Transaction().add(...instructions), feePayer, signers };
}
