import BN from "bn.js";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Buffer } from "buffer";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  ZKUBE_PROGRAM_ID,
} from "./constants.js";
import {
  deriveArcadeArchivePda,
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
  activeRunIdForSlot,
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
import { formatSolBalanceLamports } from "@/utils/currency";
import { IDL } from "./idl/index.js";
import {
  ARCADE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
} from "./protocolVersions.generated.js";

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

export type DailyStatus = "funding" | "open" | "finalized" | "unknown";

export function parseDailyStatus(value: unknown): DailyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "unknown";
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

export function currentDailyDayId(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
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
  const [profile, player, arcadeConfig, following] = await Promise.all([
    program.account.playerState.fetchNullable(derivePlayerStatePda(owner)),
    program.account.arenaPlayer.fetchNullable(
      deriveArenaPlayerPda(address, owner),
    ),
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
  const names = new Map(
    labels.map((label) => [label.owner.toBase58(), label.displayName]),
  );
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
    activeRunId: activeRunIdForSlot(profile, "arcade"),
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
    throw new Error(
      "Every Arena entry requires the connected owner wallet signature",
    );
  }
  await assertRankedEntryDependencies({
    connection: args.connection,
    wallet: args.wallet,
    daily: args.daily,
  });
  const addresses = deriveRunAddresses(owner, args.daily.nextRunId);
  await assertPreparedRunAddressesAvailable(
    args.connection,
    owner,
    args.daily.nextRunId,
    addresses,
  );
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
      `Enter Arena · exact ${formatSolBalanceLamports(args.daily.entryLamports)} SOL + network fee`,
      args.connection,
      owner,
      [instruction],
    ),
  };
}

const rankedDependencyCoder = new BorshAccountsCoder(
  convertIdlToCamelCase(IDL),
);

const RANKED_ACCOUNT_SPACES = {
  protocolConfig: 156,
  arcadeConfig: 119,
  arenaDaily: 7_426,
  weeklyJackpot: 5_925,
  season: 2_222,
  operatorRevenueVault: 58,
} as const;

type RankedAccountName = keyof typeof RANKED_ACCOUNT_SPACES;

interface RankedEntryAccount {
  name: RankedAccountName;
  label: string;
  address: PublicKey;
}

interface RankedEntryDependencyValues {
  protocol: PublicKey;
  arcadeConfig: PublicKey;
  currentDaily: PublicKey;
  currentWeekly: PublicKey;
  currentSeason: PublicKey;
  followingDaily: PublicKey;
  followingWeekly: PublicKey;
  followingSeason: PublicKey;
  operatorRevenueVault: PublicKey;
}

/**
 * Fail closed before an owner wallet prompt if any exact cadence dependency
 * disappeared, was substituted, or no longer matches the Daily snapshot.
 *
 * The checks intentionally use fixed offsets only for the account identity
 * prefix shared by every valid account revision. The variable leaderboard
 * tails are still bounded by the exact deployed allocation.
 */
export async function assertRankedEntryDependencies(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<RankedEntryDependencyValues> {
  const program = zkubeProgram(args.connection as Connection, args.wallet);
  const protocol = deriveProtocolConfigPda();
  const arcadeConfig = deriveArcadeConfigPda();
  const values: RankedEntryDependencyValues = {
    protocol,
    arcadeConfig,
    currentDaily: deriveArenaDailyPda(args.daily.dayId),
    currentWeekly: deriveWeeklyJackpotPda(args.daily.weeklyId),
    currentSeason: deriveSeasonPda(args.daily.seasonId),
    followingDaily: deriveArenaDailyPda(args.daily.dayId + 1),
    followingWeekly: deriveWeeklyJackpotPda(args.daily.weeklyId + 1),
    followingSeason: deriveSeasonPda(args.daily.seasonId + 1),
    operatorRevenueVault: deriveOperatorRevenueVaultPda(),
  };
  if (!args.daily.address.equals(values.currentDaily)) {
    throw rankedEntryUnavailable("current Daily PDA does not match its day");
  }
  const accounts: RankedEntryAccount[] = [
    { name: "protocolConfig", label: "protocol config", address: protocol },
    { name: "arcadeConfig", label: "Arcade config", address: arcadeConfig },
    {
      name: "arenaDaily",
      label: "current Daily",
      address: values.currentDaily,
    },
    {
      name: "weeklyJackpot",
      label: "current Weekly",
      address: values.currentWeekly,
    },
    { name: "season", label: "current Season", address: values.currentSeason },
    {
      name: "arenaDaily",
      label: "following Daily",
      address: values.followingDaily,
    },
    {
      name: "weeklyJackpot",
      label: "following Weekly",
      address: values.followingWeekly,
    },
    {
      name: "season",
      label: "following Season",
      address: values.followingSeason,
    },
    {
      name: "operatorRevenueVault",
      label: "operator revenue vault",
      address: values.operatorRevenueVault,
    },
  ];
  const infos = await args.connection.getMultipleAccountsInfo(
    accounts.map(({ address }) => address),
    "confirmed",
  );
  if (infos.length !== accounts.length) {
    throw rankedEntryUnavailable("dependency RPC response was incomplete");
  }
  const exact = accounts.map((account, index) =>
    assertExactRankedAccount(account, infos[index] ?? null),
  );
  const [
    protocolInfo,
    arcadeConfigInfo,
    currentDailyInfo,
    currentWeeklyInfo,
    currentSeasonInfo,
    followingDailyInfo,
    followingWeeklyInfo,
    followingSeasonInfo,
    operatorVaultInfo,
  ] = exact;

  assertVersion(protocolInfo!, PROTOCOL_ACCOUNT_VERSION, "protocol config");
  assertVersion(arcadeConfigInfo!, ARCADE_ACCOUNT_VERSION, "Arcade config");
  assertVersion(currentDailyInfo!, ARCADE_ACCOUNT_VERSION, "current Daily");
  assertVersion(currentWeeklyInfo!, ARCADE_ACCOUNT_VERSION, "current Weekly");
  assertVersion(currentSeasonInfo!, ARCADE_ACCOUNT_VERSION, "current Season");
  assertVersion(followingDailyInfo!, ARCADE_ACCOUNT_VERSION, "following Daily");
  assertVersion(
    followingWeeklyInfo!,
    ARCADE_ACCOUNT_VERSION,
    "following Weekly",
  );
  assertVersion(
    followingSeasonInfo!,
    ARCADE_ACCOUNT_VERSION,
    "following Season",
  );
  assertVersion(
    operatorVaultInfo!,
    ARCADE_ACCOUNT_VERSION,
    "operator revenue vault",
  );

  assertPubkeyAt(arcadeConfigInfo!, 9, protocol, "Arcade config protocol");
  assertU64At(
    arcadeConfigInfo!,
    73,
    args.daily.entryLamports,
    "Arcade entry price",
  );
  assertDailyIdentity(currentDailyInfo!, {
    dayId: args.daily.dayId,
    weeklyId: args.daily.weeklyId,
    seasonId: args.daily.seasonId,
    arcadeConfig,
    label: "current Daily",
  });
  assertDailyIdentity(followingDailyInfo!, {
    dayId: args.daily.dayId + 1,
    arcadeConfig,
    label: "following Daily",
  });
  assertCadenceIdentity(
    currentWeeklyInfo!,
    args.daily.weeklyId,
    arcadeConfig,
    "current Weekly",
  );
  assertCadenceIdentity(
    followingWeeklyInfo!,
    args.daily.weeklyId + 1,
    arcadeConfig,
    "following Weekly",
  );
  assertCadenceIdentity(
    currentSeasonInfo!,
    args.daily.seasonId,
    arcadeConfig,
    "current Season",
  );
  assertCadenceIdentity(
    followingSeasonInfo!,
    args.daily.seasonId + 1,
    arcadeConfig,
    "following Season",
  );
  assertPubkeyAt(
    operatorVaultInfo!,
    9,
    protocol,
    "operator revenue vault protocol",
  );

  // The program object is deliberately constructed here, even though the
  // fixed-prefix verifier does not decode variable tails: it binds the
  // preflight to the same deployed program ID used to build the instruction.
  if (!program.programId.equals(ZKUBE_PROGRAM_ID)) {
    throw rankedEntryUnavailable("client program identity is invalid");
  }
  return values;
}

function assertExactRankedAccount(
  account: RankedEntryAccount,
  info: AccountInfo<Buffer> | null,
): Buffer {
  if (!info) throw rankedEntryUnavailable(`${account.label} is not prepared`);
  const expectedSize = RANKED_ACCOUNT_SPACES[account.name];
  if (
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.data.length !== expectedSize
  ) {
    throw rankedEntryUnavailable(
      `${account.label} owner or allocation is invalid`,
    );
  }
  const data = Buffer.from(info.data);
  const discriminator = rankedDependencyCoder.accountDiscriminator(
    account.name,
  );
  if (!data.subarray(0, discriminator.length).equals(discriminator)) {
    throw rankedEntryUnavailable(`${account.label} discriminator is invalid`);
  }
  return data;
}

function assertVersion(data: Buffer, expected: number, label: string): void {
  if (data.readUInt8(8) !== expected) {
    throw rankedEntryUnavailable(`${label} version is invalid`);
  }
}

function assertDailyIdentity(
  data: Buffer,
  expected: {
    dayId: number;
    weeklyId?: number;
    seasonId?: number;
    arcadeConfig: PublicKey;
    label: string;
  },
): void {
  assertU32At(data, 9, expected.dayId, `${expected.label} day`);
  if (expected.weeklyId !== undefined) {
    assertU32At(data, 13, expected.weeklyId, `${expected.label} week`);
  }
  if (expected.seasonId !== undefined) {
    assertU32At(data, 17, expected.seasonId, `${expected.label} Season`);
  }
  assertPubkeyAt(data, 21, expected.arcadeConfig, `${expected.label} config`);
}

function assertCadenceIdentity(
  data: Buffer,
  id: number,
  arcadeConfig: PublicKey,
  label: string,
): void {
  assertU32At(data, 9, id, `${label} ID`);
  assertPubkeyAt(data, 17, arcadeConfig, `${label} config`);
}

function assertU32At(
  data: Buffer,
  offset: number,
  expected: number,
  label: string,
): void {
  if (data.readUInt32LE(offset) !== expected) {
    throw rankedEntryUnavailable(`${label} relationship is invalid`);
  }
}

function assertU64At(
  data: Buffer,
  offset: number,
  expected: bigint,
  label: string,
): void {
  if (data.readBigUInt64LE(offset) !== expected) {
    throw rankedEntryUnavailable(`${label} relationship is invalid`);
  }
}

function assertPubkeyAt(
  data: Buffer,
  offset: number,
  expected: PublicKey,
  label: string,
): void {
  const actual = new PublicKey(data.subarray(offset, offset + 32));
  if (!actual.equals(expected)) {
    throw rankedEntryUnavailable(`${label} relationship is invalid`);
  }
}

function rankedEntryUnavailable(reason: string): Error {
  return new Error(
    `Ranked entry is temporarily unavailable: ${reason}. Your wallet was not prompted and no entry was charged.`,
  );
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
  return erPlan(
    "Commit Arena result",
    args.erConnection,
    args.payerWallet.publicKey,
    [instruction],
  );
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
  const config = await program.account.arcadeConfig.fetch(
    deriveArcadeConfigPda(),
  );
  const instruction = await program.methods
    .prepareArenaDaily(dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arcadeArchive: deriveArcadeArchivePda(),
      dailyRulesCatalog: config.rulesCatalog,
      arenaDaily: challenge,
      payer: args.payer ?? args.wallet.publicKey,
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    "Prepare Arena Daily",
    args.connection,
    args.payer ?? args.wallet.publicKey,
    [instruction],
  );
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
  return basePlan("Push Arena prizes", args.connection, args.wallet.publicKey, [
    instruction,
  ]);
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

function erPlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): TransactionPlan {
  return {
    layer: "magicblock-er",
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers,
  };
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
