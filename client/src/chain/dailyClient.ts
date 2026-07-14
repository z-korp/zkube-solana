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
import { buildTopUpMagicActionEscrowInstruction } from "./magicAction.js";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveWeeklyStipendPda,
  deriveWeeklyChallengePda,
} from "./pdas.js";
import { fetchEconomyRuntime } from "./economyClient.js";
import {
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type EndlessRulesView,
  type PreparedRunPlan,
  type RawLevelRuleSnapshot,
  type TransactionPlan,
} from "./runPlan.js";
import {
  mapDailyPressureProfile,
  mapDailyScoringRule,
  type DailyPressureProfileView,
  type DailyScoringRuleView,
  type RawDailyPressureProfile,
  type RawDailyScoringRule,
} from "./dailyRules.js";
import type { WalletLike } from "./sessionWallet.js";

export interface DailyLeaderboardView {
  player: PublicKey;
  receipt: PublicKey;
  runId: bigint;
  dailyScore: number;
  engineScore: number;
  moves: number;
  /** Daily score compatibility alias for generic rank components. */
  score: number;
  submittedAt: number;
}

export interface DailyPlayerView {
  attempts: number;
  finalizedAttempts: number;
  bestRunId: bigint;
  bestDailyScore: number;
  bestEngineScore: number;
  bestMoves: number;
  /** Daily score compatibility alias for generic rank components. */
  bestScore: number;
  starRefunded: boolean;
  dailyXpAwarded: boolean;
  pressureMasteryXpAwarded: boolean;
  weeklyRolledUp: boolean;
}

export interface DailyGameRulesView extends EndlessRulesView {
  rules: ActiveRunRulesView;
  scoringRule: DailyScoringRuleView;
  pressure: DailyPressureProfileView;
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

const DAILY_STATUSES: ReadonlySet<DailyStatus> = new Set([
  "draft",
  "open",
  "entriesClosed",
  "finalizing",
  "claimable",
  "cancelled",
  "closed",
]);

export function parseDailyStatus(value: unknown): DailyStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "unknown";
  }
  const status = Object.keys(value)[0];
  return status && DAILY_STATUSES.has(status as DailyStatus)
    ? (status as DailyStatus)
    : "unknown";
}

export interface RawDailyGameRulesSnapshot {
  rules: RawLevelRuleSnapshot;
  scoringRule: RawDailyScoringRule;
  pressure: RawDailyPressureProfile;
}

export function mapDailyGameRulesSnapshot(
  challenge: RawDailyGameRulesSnapshot,
): DailyGameRulesView {
  const pressure = mapDailyPressureProfile(challenge.pressure);
  return {
    rules: mapLevelRuleSnapshot(challenge.rules),
    scoringRule: mapDailyScoringRule(challenge.scoringRule),
    pressure,
    endlessThresholds: pressure.thresholds,
    endlessScoreMultipliersX100: pressure.scoreMultipliersX100,
    endlessRampMultiplierX100: 100,
  };
}

export interface DailyView extends DailyGameRulesView {
  economyVersion: 2;
  address: PublicKey;
  dayId: number;
  weekId: number;
  seasonId: number;
  status: DailyStatus;
  mapId: number;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  finalizedAt: number;
  starEntryCost: bigint;
  uniquePlayers: number;
  closedPlayers: number;
  weeklyEligiblePlayers: number;
  weeklyRollups: number;
  attemptsStarted: bigint;
  runsFinalized: bigint;
  playerEligible: boolean;
  playerStars: bigint;
  nextRunId: bigint;
  player: DailyPlayerView | null;
  leaderboard: DailyLeaderboardView[];
}

export function currentDailyDayId(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return Math.max(0, Math.floor(nowUnix / 86_400));
}

export async function buildOpenDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  dayId?: number;
  paymaster: PublicKey;
}): Promise<TransactionPlan> {
  const dayId = args.dayId ?? currentDailyDayId();
  const runtime = await fetchEconomyRuntime(args);
  if (!runtime) throw new Error("Economy is not active");
  const caller = args.wallet.publicKey;
  const challenge = deriveDailyChallengePda(dayId);
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.openDailyChallenge(dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(runtime.dailyRulesVersion),
      dailyChallenge: challenge,
      leaderboard: deriveDailyLeaderboardPda(challenge),
      payer: args.paymaster,
      caller,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Open Daily challenge", args.connection, args.paymaster, [
    instruction,
  ]);
}

export async function buildFinalizeDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.finalizeDailyChallenge()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      leaderboard: deriveDailyLeaderboardPda(args.daily.address),
      caller,
    })
    .instruction();
  return basePlan(
    "Finalize Daily challenge",
    args.connection,
    args.paymaster ?? caller,
    [instruction],
  );
}

export async function fetchDailyView(args: {
  connection: Connection;
  wallet: WalletLike;
  dayId?: number;
}): Promise<DailyView | null> {
  const dayId = args.dayId ?? currentDailyDayId();
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const [profile, protocol, economy] = await Promise.all([
    program.account.playerProfile.fetchNullable(derivePlayerProfilePda(owner)),
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.economyConfig.fetchNullable(deriveEconomyConfigPda()),
  ]);
  if (
    !protocol ||
    !economy?.active ||
    Number(economy.contentVersion) !== Number(protocol.contentVersion)
  )
    return null;
  const address = deriveDailyChallengePda(dayId);
  const challenge = await program.account.dailyChallenge.fetchNullable(address);
  if (!challenge) return null;
  const [player, leaderboard] = await Promise.all([
    program.account.dailyPlayer.fetchNullable(
      deriveDailyPlayerPda(address, owner),
    ),
    program.account.dailyLeaderboard.fetchNullable(
      deriveDailyLeaderboardPda(address),
    ),
  ]);
  return {
    economyVersion: 2,
    address,
    dayId: Number(challenge.dayId),
    weekId: Number(challenge.weekId),
    seasonId: Number(challenge.seasonId),
    status: parseDailyStatus(challenge.status),
    mapId: Number(challenge.mapId),
    ...mapDailyGameRulesSnapshot(challenge),
    opensAt: Number(challenge.opensAt),
    entriesCloseAt: Number(challenge.entriesCloseAt),
    runsCloseAt: Number(challenge.runsCloseAt),
    settlementGraceCloseAt: Number(challenge.settlementGraceCloseAt),
    finalizedAt: Number(challenge.finalizedAt),
    starEntryCost: asBigInt(challenge.entryStars),
    uniquePlayers: Number(challenge.uniquePlayers),
    closedPlayers: Number(challenge.closedPlayers),
    weeklyEligiblePlayers: Number(challenge.weeklyEligiblePlayers),
    weeklyRollups: Number(challenge.weeklyRollups),
    attemptsStarted: asBigInt(challenge.attemptsStarted),
    runsFinalized: asBigInt(challenge.runsFinalized),
    playerEligible: Boolean(profile?.dailyEligible),
    playerStars: profile ? asBigInt(profile.starsBalance) : 0n,
    nextRunId: profile ? asBigInt(profile.nextRunId) : 0n,
    player: player
      ? {
          attempts: Number(player.attempts),
          finalizedAttempts: Number(player.finalizedAttempts),
          bestRunId: asBigInt(player.bestRunId),
          bestDailyScore: Number(player.bestDailyScore),
          bestEngineScore: Number(player.bestEngineScore),
          bestMoves: Number(player.bestMoves),
          bestScore: Number(player.bestDailyScore),
          starRefunded: Boolean(player.starRefunded),
          dailyXpAwarded: Boolean(player.dailyXpAwarded),
          pressureMasteryXpAwarded: Boolean(player.pressureMasteryXpAwarded),
          weeklyRolledUp: Boolean(player.weeklyRolledUp),
        }
      : null,
    leaderboard: (leaderboard?.entries ?? []).map((entry) => ({
      player: entry.player,
      receipt: entry.receipt,
      runId: asBigInt(entry.runId),
      dailyScore: Number(entry.dailyScore),
      engineScore: Number(entry.engineScore),
      moves: Number(entry.moves),
      score: Number(entry.dailyScore),
      submittedAt: Number(entry.submittedAt),
    })),
  };
}

export async function buildPrepareDailyRunPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  daily: DailyView;
  paymaster?: PublicKey;
  sessionValidUntil: number;
}): Promise<PreparedRunPlan> {
  if (args.daily.nextRunId <= 0n)
    throw new Error("Daily eligibility requires a player profile");
  const owner = args.ownerAuthority;
  const actor = args.wallet.publicKey;
  const payer = args.paymaster ?? owner;
  const addresses = deriveRunAddresses(owner, args.daily.nextRunId);
  const instructions: TransactionInstruction[] = [];
  instructions.push(
    buildTopUpMagicActionEscrowInstruction({ authority: owner, payer }),
  );
  const program = zkubeProgram(args.connection, args.wallet);
  const common = {
    protocol: deriveProtocolConfigPda(),
    playerProfile: derivePlayerProfilePda(owner),
    dailyChallenge: args.daily.address,
    dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
    runShell: addresses.runShell,
    activeRun: addresses.activeRun,
    runReceipt: addresses.runReceipt,
    payer,
    ownerAuthority: owner,
    sessionToken: args.sessionToken,
    actor,
    systemProgram: SystemProgram.programId,
  };
  const enter = await program.methods
    .enterDaily(new BN(args.daily.nextRunId.toString()))
    .accountsPartial({
      ...common,
      economyConfig: deriveEconomyConfigPda(),
      weeklyStipend: deriveWeeklyStipendPda(owner),
    })
    .instruction();
  instructions.push(enter);
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: basePlan(
      `Enter Daily with ${args.daily.starEntryCost.toString()} Stars`,
      args.connection,
      payer,
      instructions,
      [],
    ),
  };
}

export async function buildCommitDailyRunPlan(args: {
  owner: PublicKey;
  payerWallet: WalletLike;
  addresses: ReturnType<typeof deriveRunAddresses>;
  dailyChallenge: PublicKey;
  economyVersion?: 1 | 2;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.payerWallet);
  const common = {
    payer: args.payerWallet.publicKey,
    activeRun: args.addresses.activeRun,
    runShell: args.addresses.runShell,
    runReceipt: args.addresses.runReceipt,
    playerProfile: derivePlayerProfilePda(args.owner),
    dailyChallenge: args.dailyChallenge,
    dailyPlayer: deriveDailyPlayerPda(args.dailyChallenge, args.owner),
    leaderboard: deriveDailyLeaderboardPda(args.dailyChallenge),
    weeklyStipend: deriveWeeklyStipendPda(args.owner),
    owner: args.owner,
    magicContext: MAGIC_CONTEXT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
  };
  const instruction = await program.methods
    .commitDailyRun()
    .accountsPartial(common)
    .instruction();
  return basePlan(
    "Commit Daily result",
    args.erConnection,
    args.payerWallet.publicKey,
    [instruction],
  );
}

export async function buildRefundDailyEntryPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  daily: DailyView;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.refundDailyStars()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
      playerProfile: derivePlayerProfilePda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    "Refund cancelled Daily Stars",
    args.connection,
    args.paymaster ?? owner,
    [instruction],
  );
}

export interface DailyPlayerRecord {
  address: PublicKey;
  owner: PublicKey;
  attempts: number;
  finalizedAttempts: number;
  bestRunId: bigint;
  weeklyRolledUp: boolean;
  starRefunded: boolean;
}

export async function fetchDailyPlayerRecords(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<DailyPlayerRecord[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const matches = await program.account.dailyPlayer.all([
    { memcmp: { offset: 9, bytes: args.daily.address.toBase58() } },
  ]);
  return matches
    .map((match) => {
      const player = match.account as unknown as {
        version: number;
        challenge: PublicKey;
        player: PublicKey;
        attempts: number;
        finalizedAttempts: number;
        bestRunId: { toString(): string };
        weeklyRolledUp: boolean;
        starRefunded: boolean;
      };
      const attempts = Number(player.attempts);
      const finalizedAttempts = Number(player.finalizedAttempts);
      if (
        Number(player.version) !== 1 ||
        !player.challenge.equals(args.daily.address) ||
        !Number.isSafeInteger(attempts) ||
        attempts < 0 ||
        !Number.isSafeInteger(finalizedAttempts) ||
        finalizedAttempts < 0 ||
        finalizedAttempts > attempts ||
        !match.publicKey.equals(deriveDailyPlayerPda(args.daily.address, player.player))
      ) {
        throw new Error("Daily cleanup player relationship is invalid");
      }
      return {
        address: match.publicKey,
        owner: player.player,
        attempts,
        finalizedAttempts,
        bestRunId: asBigInt(player.bestRunId),
        weeklyRolledUp: Boolean(player.weeklyRolledUp),
        starRefunded: Boolean(player.starRefunded),
      };
    })
    .sort((left, right) => left.owner.toBuffer().compare(right.owner.toBuffer()));
}

export async function fetchDailyChallengeIds(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<number[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const matches = await program.account.dailyChallenge.all();
  return matches
    .map((match) => {
      const challenge = match.account as unknown as { version: number; dayId: number };
      const dayId = Number(challenge.dayId);
      if (
        Number(challenge.version) !== 1 ||
        !Number.isSafeInteger(dayId) ||
        dayId < 0 ||
        !match.publicKey.equals(deriveDailyChallengePda(dayId))
      ) {
        throw new Error("Daily challenge PDA relationship is invalid");
      }
      return dayId;
    })
    .sort((left, right) => left - right);
}

export async function fetchOwnerCancelledDailyIds(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<number[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const matches = await program.account.dailyPlayer.all([
    { memcmp: { offset: 41, bytes: owner.toBase58() } },
  ]);
  const dayIds: number[] = [];
  for (const match of matches) {
    const player = match.account as unknown as {
      version: number;
      challenge: PublicKey;
      player: PublicKey;
      starRefunded: boolean;
    };
    if (
      Number(player.version) !== 1 ||
      !player.player.equals(owner) ||
      !match.publicKey.equals(deriveDailyPlayerPda(player.challenge, owner))
    ) {
      throw new Error("Owner Daily refund scan returned an invalid player account");
    }
    if (player.starRefunded) continue;
    const challenge = await program.account.dailyChallenge.fetchNullable(player.challenge);
    if (!challenge || Number(challenge.version) !== 1) {
      throw new Error("Owner Daily refund scan returned an invalid challenge account");
    }
    const dayId = Number(challenge.dayId);
    if (
      !Number.isSafeInteger(dayId) ||
      dayId < 0 ||
      !player.challenge.equals(deriveDailyChallengePda(dayId))
    ) {
      throw new Error("Owner Daily refund challenge PDA is invalid");
    }
    if (parseDailyStatus(challenge.status) === "cancelled") dayIds.push(dayId);
  }
  return dayIds.sort((left, right) => left - right);
}

export async function buildCloseDailyPlayerPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  owner: PublicKey;
  paymaster: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .closeDailyPlayer()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      dailyChallenge: args.daily.address,
      weeklyChallenge: deriveWeeklyChallengePda(args.daily.weekId),
      owner: args.owner,
      dailyPlayer: deriveDailyPlayerPda(args.daily.address, args.owner),
      rentRecipient: args.paymaster,
      caller: args.wallet.publicKey,
    })
    .instruction();
  return basePlan("Close settled Daily player record", args.connection, args.paymaster, [instruction]);
}

export async function buildCloseDailyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  paymaster: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .closeDailyChallenge()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyChallenge: deriveWeeklyChallengePda(args.daily.weekId),
      rentRecipient: args.paymaster,
      dailyChallenge: args.daily.address,
      leaderboard: deriveDailyLeaderboardPda(args.daily.address),
      caller: args.wallet.publicKey,
    })
    .instruction();
  return basePlan("Close settled Daily challenge", args.connection, args.paymaster, [instruction]);
}

function basePlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers,
  };
}

function asBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}
