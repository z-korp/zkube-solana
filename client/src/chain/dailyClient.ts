import BN from "bn.js";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Buffer } from "buffer";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountMeta,
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
  deriveArenaBoardPda,
  deriveArenaDailyPda,
  deriveArenaPlayerPda,
  deriveCadenceFundingPda,
  deriveCreditVaultPda,
  deriveMapCatalogPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
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
  dailyPressureThresholds,
  mapDailyPressureProfile,
  dailyContentSelection,
  nextScheduledDaily,
  type DailyPressureProfileView,
  type DailyThemeView,
} from "./dailyRules.js";
import { fetchPlayerLabels } from "./playerLabelClient.js";
import type { WalletLike } from "./sessionWallet.js";
import { payoutForRank } from "@/ui/components/economy/payout";
import { formatSolBalanceLamports } from "@/utils/currency";
import { IDL } from "./idl/index.js";
import {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  PROTOCOL_ACCOUNT_VERSION,
} from "./protocolVersions.generated.js";

export interface DailyLeaderboardView {
  player: PublicKey;
  playerName: string | null;
  runId: bigint;
  dailyScore: number;
  objectiveTotal: bigint;
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
  bestEngineScore: number;
  bestMoves: number;
  bestScore: number;
  activePaidRunId: bigint;
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
  followingDayId: number | null;
  status: DailyStatus;
  mapId: number;
  opensAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  recoveryDeadlineAt: number;
  finalizedAt: number;
  entryLamports: bigint;
  dailyPotLamports: bigint;
  followingDailyLamports: bigint | null;
  kreditBalance: bigint;
  uniquePlayers: number;
  attemptsStarted: bigint;
  runsFinalized: bigint;
  entriesExpired: bigint;
  rulesHash: Uint8Array;
  nextRunId: bigint;
  activeRunId: bigint;
  player: DailyPlayerView | null;
  leaderboard: DailyLeaderboardView[];
  themeLeaderboard: DailyLeaderboardView[];
  scoreQualifiedPlayers: number;
  themeQualifiedPlayers: number;
  rules: ActiveRunRulesView;
  dailyTheme: DailyThemeView;
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
  const status = parseDailyStatus(challenge.status);
  const [profile, player, arcadeConfig, boardRows] = await Promise.all([
    program.account.playerState.fetchNullable(derivePlayerStatePda(owner)),
    program.account.arenaPlayer.fetchNullable(
      deriveArenaPlayerPda(address, owner),
    ),
    program.account.arcadeConfig.fetch(deriveArcadeConfigPda()),
    status === "finalized"
      ? Promise.all([
          fetchDailyBoardEntries(args.connection, address, dayId, "score"),
          fetchDailyBoardEntries(args.connection, address, dayId, "theme"),
        ])
      : Promise.resolve([[], []] as const),
  ]);
  const followingDayId = nextScheduledDaily(
    dayId,
    Number(arcadeConfig.suspendedUntilDay),
  );
  const following = await program.account.arenaDaily.fetchNullable(
    deriveArenaDailyPda(followingDayId),
  );
  const [rows, themeRows] = boardRows;
  const labels = await fetchPlayerLabels({
    connection: args.connection,
    wallet: args.wallet,
    owners: [...rows, ...themeRows].map((entry) => entry.player),
  }).catch(() => []);
  const names = new Map(
    labels.map((label) => [label.owner.toBase58(), label.displayName]),
  );
  const pressure = mapDailyPressureProfile(challenge.pressure);
  return {
    address,
    dayId: Number(challenge.dayId),
    followingDayId,
    status,
    mapId: Number(challenge.mapId),
    opensAt: Number(challenge.opensAt),
    runsCloseAt: Number(challenge.runsCloseAt),
    settlementGraceCloseAt: Number(challenge.recoveryDeadlineAt),
    recoveryDeadlineAt: Number(challenge.recoveryDeadlineAt),
    finalizedAt: Number(challenge.finalizedAt),
    entryLamports: ARENA_ENTRY_LAMPORTS,
    dailyPotLamports: availablePoolLamports(challenge.ledger),
    followingDailyLamports: following
      ? availablePoolLamports(following.ledger)
      : null,
    kreditBalance: profile ? BigInt(profile.kreditBalance.toString()) : 0n,
    uniquePlayers: Number(challenge.uniquePlayers),
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
          bestRunId: player.hasScoreBest
            ? BigInt(player.scoreBestRunId.toString())
            : 0n,
          bestDailyScore: player.hasScoreBest
            ? Number(player.scoreBestEntry.score)
            : 0,
          bestEngineScore: player.hasScoreBest
            ? Number(player.scoreBestEntry.score)
            : 0,
          bestMoves: 0,
          bestScore: player.hasScoreBest
            ? Number(player.scoreBestEntry.score)
            : 0,
          activePaidRunId: BigInt(player.activePaidRunId.toString()),
        }
      : null,
    leaderboard: rows.map((entry) => ({
      ...entry,
      playerName: names.get(entry.player.toBase58()) ?? null,
    })),
    themeLeaderboard: themeRows.map((entry) => ({
      ...entry,
      playerName: names.get(entry.player.toBase58()) ?? null,
    })),
    scoreQualifiedPlayers: Number(challenge.scoreQualifiedPlayers),
    themeQualifiedPlayers: Number(challenge.themeQualifiedPlayers),
    rules: mapLevelRuleSnapshot(challenge.rules, Number(challenge.mapId), 1),
    dailyTheme: {
      kind: Number(challenge.dailyTheme.kind),
      value: Number(challenge.dailyTheme.value),
    },
    pressure,
    endlessThresholds: dailyPressureThresholds(),
    endlessScoreMultipliersX100: pressure.scoreMultipliersX100,
  };
}

const ARENA_BOARD_HEADER_BYTES = 125;
const ARENA_BOARD_ENTRY_BYTES = 84;
const ARENA_BOARD_CAPACITY = 1_536;
const MAX_AUTO_CLAIMS_PER_ENTRY = 2;
const AUTO_CLAIM_LOOKBACK_DAYS = 30;

async function fetchDailyBoardEntries(
  connection: Connection,
  daily: PublicKey,
  dayId: number,
  kind: "score" | "theme",
): Promise<DailyLeaderboardView[]> {
  const address = deriveArenaBoardPda(daily, kind);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return [];
  const data = Buffer.from(info.data);
  const discriminator =
    rankedDependencyCoder.accountDiscriminator("arenaBoard");
  if (
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    data.length < ARENA_BOARD_HEADER_BYTES ||
    !data.subarray(0, discriminator.length).equals(discriminator) ||
    data.readUInt8(8) !== ARCADE_ACCOUNT_VERSION ||
    !new PublicKey(data.subarray(9, 41)).equals(daily) ||
    data.readUInt32LE(41) !== dayId ||
    data.readUInt8(45) !== (kind === "score" ? 0 : 1)
  ) {
    throw new Error(`${kind} Daily board identity is invalid`);
  }
  const payoutCount = data.readUInt32LE(54);
  const cursor = data.readUInt32LE(99);
  const sealed = data.readUInt8(103) !== 0;
  const sealedAt = Number(data.readBigInt64LE(104));
  const bitmapBytes = Math.ceil(payoutCount / 8);
  const expectedSize =
    ARENA_BOARD_HEADER_BYTES +
    payoutCount * ARENA_BOARD_ENTRY_BYTES +
    bitmapBytes;
  if (
    payoutCount > ARENA_BOARD_CAPACITY ||
    cursor > payoutCount ||
    sealed !== sealedAt > 0 ||
    data.length !== expectedSize
  ) {
    throw new Error(`${kind} Daily board allocation is invalid`);
  }
  // A partially constructed board is deliberately not a claimable or public
  // result. Publish it only after the program has verified and sealed all rows.
  if (!sealed || cursor !== payoutCount) return [];

  return Array.from({ length: payoutCount }, (_, position) => {
    const offset =
      ARENA_BOARD_HEADER_BYTES + position * ARENA_BOARD_ENTRY_BYTES;
    const row = data.subarray(offset, offset + ARENA_BOARD_ENTRY_BYTES);
    const score = row.readUInt32LE(32);
    return {
      player: new PublicKey(row.subarray(0, 32)),
      playerName: null,
      runId: 0n,
      dailyScore: score,
      objectiveTotal: row.readBigUInt64LE(36),
      engineScore: score,
      moves: 0,
      finalizedAttempts: 0,
      score,
      submittedAt: Number(row.readBigInt64LE(44)),
      replayHash: Uint8Array.from(row.subarray(52, 84)),
    };
  });
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
  const followingDayId = requireFollowingDaily(args.daily);
  if (args.daily.kreditBalance < 1n) {
    throw new Error("Buy a Kredit with the owner wallet before entering Arena");
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
  const autoClaims = await discoverAutoClaims({
    connection: args.connection,
    owner,
    currentDayId: args.daily.dayId,
  }).catch(() => []);
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.fundedEnterArena(
      new BN(args.daily.nextRunId.toString()),
      new BN(args.daily.entryLamports.toString()),
      autoClaims.map(({ position }) => position),
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      playerState: derivePlayerStatePda(owner),
      currentDaily: args.daily.address,
      arenaPlayer: deriveArenaPlayerPda(args.daily.address, owner),
      followingDaily: deriveArenaDailyPda(followingDayId),
      creditVault: deriveCreditVaultPda(),
      activeRun: addresses.activeRun,
      playerFunding: derivePlayerFundingPda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .remainingAccounts(autoClaims.flatMap(({ accounts }) => accounts))
    .instruction();
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: basePlan(
      "Enter Arena · spend 1 Kredit + network fee",
      args.connection,
      args.wallet.publicKey,
      [instruction],
    ),
  };
}

/** One sealed, unexpired board place this wallet has not collected yet. */
export interface UnclaimedRewardView {
  dayId: number;
  board: "score" | "theme";
  /** Row index on the board; the rank is one higher. */
  position: number;
  rank: number;
  amountLamports: bigint;
  /** Instant the claim window closes and the reward rolls into the next pot. */
  expiresAt: number;
}

interface BoardIdentity {
  dayId: number;
  daily: PublicKey;
  kind: "score" | "theme";
  board: PublicKey;
}

function claimLookbackIdentities(currentDayId: number): BoardIdentity[] {
  const firstDay = Math.max(0, currentDayId - AUTO_CLAIM_LOOKBACK_DAYS);
  return Array.from(
    { length: Math.max(0, currentDayId - firstDay) },
    (_, offset) => firstDay + offset,
  ).flatMap((dayId) => {
    const daily = deriveArenaDailyPda(dayId);
    return (["score", "theme"] as const).map((kind) => ({
      dayId,
      daily,
      kind,
      board: deriveArenaBoardPda(daily, kind),
    }));
  });
}

async function scanUnclaimedBoards(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  owner: PublicKey;
  currentDayId: number;
  nowUnix?: number;
}): Promise<Array<BoardIdentity & UnclaimedBoardReward>> {
  const identities = claimLookbackIdentities(args.currentDayId);
  if (identities.length === 0) return [];
  const infos = await args.connection.getMultipleAccountsInfo(
    identities.map(({ board }) => board),
    "confirmed",
  );
  if (infos.length !== identities.length) return [];
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1_000);
  const candidates = identities.flatMap((identity, index) => {
    const info = infos[index];
    if (!info) return [];
    const reward = unclaimedBoardReward(
      info,
      identity.daily,
      identity.dayId,
      identity.kind,
      args.owner,
      nowUnix,
    );
    return reward === null ? [] : [{ ...identity, ...reward }];
  });
  // Oldest window first: the one closest to expiring is the one worth doing.
  candidates.sort(
    (left, right) =>
      left.sealedAt - right.sealedAt ||
      left.dayId - right.dayId ||
      left.kind.localeCompare(right.kind),
  );
  return candidates;
}

/**
 * Every reward this wallet is still owed, newest window last.
 *
 * The same thirty-day scan the entry planner already runs, reporting amounts
 * instead of account metas. Spending a Kredit collects these automatically, but
 * a winner who never plays again would otherwise have no way to be paid — and
 * the window closes.
 */
export async function fetchUnclaimedRewards(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  owner: PublicKey;
  currentDayId: number;
  nowUnix?: number;
}): Promise<UnclaimedRewardView[]> {
  const candidates = await scanUnclaimedBoards(args);
  return candidates.map((candidate) => ({
    dayId: candidate.dayId,
    board: candidate.kind,
    position: candidate.position,
    rank: candidate.position + 1,
    amountLamports: candidate.amountLamports,
    expiresAt: candidate.sealedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  }));
}

/**
 * Collect one reward directly, without spending a Kredit.
 *
 * `claim_daily_prize` takes the owner as a writable non-signer and the actor as
 * the signer, so a device session can drive it: one tap, no wallet approval,
 * and the SOL lands in the owner wallet.
 */
export async function buildClaimDailyPrizePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  dayId: number;
  board: "score" | "theme";
  position: number;
}): Promise<TransactionPlan> {
  if (!Number.isSafeInteger(args.position) || args.position < 0 ||
      args.position >= ARENA_BOARD_CAPACITY) {
    throw new Error("Daily reward position is invalid");
  }
  const daily = deriveArenaDailyPda(args.dayId);
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.claimDailyPrize(
      args.board === "score" ? { score: {} } : { theme: {} },
      args.position,
    )
    .accountsPartial({
      arenaDaily: daily,
      arenaBoard: deriveArenaBoardPda(daily, args.board),
      playerState: derivePlayerStatePda(args.ownerAuthority),
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    "Collect Daily reward",
    args.connection,
    args.wallet.publicKey,
    [instruction],
  );
}

async function discoverAutoClaims(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  owner: PublicKey;
  currentDayId: number;
  nowUnix?: number;
}): Promise<Array<{ position: number; accounts: AccountMeta[] }>> {
  const candidates = await scanUnclaimedBoards(args);
  return candidates
    .slice(0, MAX_AUTO_CLAIMS_PER_ENTRY)
    .map(({ daily, board, position }) => ({
      position,
      accounts: [
        { pubkey: daily, isSigner: false, isWritable: true },
        { pubkey: board, isSigner: false, isWritable: true },
      ],
    }));
}

interface UnclaimedBoardReward {
  sealedAt: number;
  position: number;
  amountLamports: bigint;
}

function unclaimedBoardReward(
  info: AccountInfo<Buffer>,
  daily: PublicKey,
  dayId: number,
  kind: "score" | "theme",
  owner: PublicKey,
  nowUnix: number,
): UnclaimedBoardReward | null {
  const data = Buffer.from(info.data);
  const discriminator =
    rankedDependencyCoder.accountDiscriminator("arenaBoard");
  if (
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    data.length < ARENA_BOARD_HEADER_BYTES ||
    !data.subarray(0, discriminator.length).equals(discriminator) ||
    data.readUInt8(8) !== ARCADE_ACCOUNT_VERSION ||
    !new PublicKey(data.subarray(9, 41)).equals(daily) ||
    data.readUInt32LE(41) !== dayId ||
    data.readUInt8(45) !== (kind === "score" ? 0 : 1)
  )
    return null;
  const payoutCount = data.readUInt32LE(54);
  const denominator = readU128LE(data, 58);
  const poolLamports = data.readBigUInt64LE(74);
  const cursor = data.readUInt32LE(99);
  const sealed = data.readUInt8(103) !== 0;
  const sealedAt = Number(data.readBigInt64LE(104));
  const bitmapBytes = Math.ceil(payoutCount / 8);
  const rowsEnd =
    ARENA_BOARD_HEADER_BYTES + payoutCount * ARENA_BOARD_ENTRY_BYTES;
  if (
    payoutCount > ARENA_BOARD_CAPACITY ||
    cursor !== payoutCount ||
    !sealed ||
    sealedAt <= 0 ||
    denominator === 0n ||
    nowUnix > sealedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS ||
    data.length !== rowsEnd + bitmapBytes
  )
    return null;
  const position = Array.from(
    { length: payoutCount },
    (_, index) => index,
  ).find((index) => {
    const offset = ARENA_BOARD_HEADER_BYTES + index * ARENA_BOARD_ENTRY_BYTES;
    return new PublicKey(data.subarray(offset, offset + 32)).equals(owner);
  });
  if (position === undefined) return null;
  const claimed =
    (data[rowsEnd + Math.floor(position / 8)] ?? 0) & (1 << (position % 8));
  if (claimed !== 0) return null;
  // The board's own stored pool and denominator, so the quoted amount is the
  // one the program will pay rather than a re-derived width.
  return {
    sealedAt,
    position,
    amountLamports: payoutForRank(poolLamports, denominator, position + 1),
  };
}

function readU128LE(data: Buffer, offset: number): bigint {
  return (
    data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n)
  );
}

export async function buildPurchaseKreditsPlan(args: {
  connection: Connection;
  ownerWallet: WalletLike;
  kreditCount: number;
  expectedUnitLamports?: bigint;
}): Promise<TransactionPlan> {
  if (
    !Number.isInteger(args.kreditCount) ||
    args.kreditCount < 1 ||
    args.kreditCount > 0xffff_ffff
  ) {
    throw new Error("Kredit count must be a positive u32");
  }
  const unitLamports = args.expectedUnitLamports ?? 10_000_000n;
  const owner = args.ownerWallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.ownerWallet)
    .methods.purchaseKredits(args.kreditCount, new BN(unitLamports.toString()))
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      playerState: derivePlayerStatePda(owner),
      creditVault: deriveCreditVaultPda(),
      operatorRevenueVault: deriveOperatorRevenueVaultPda(),
      owner,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    `Buy ${args.kreditCount} ${args.kreditCount === 1 ? "Kredit" : "Kredits"} · ${formatSolBalanceLamports(unitLamports * BigInt(args.kreditCount))} SOL`,
    args.connection,
    owner,
    [instruction],
  );
}

const rankedDependencyCoder = new BorshAccountsCoder(
  convertIdlToCamelCase(IDL),
);

const RANKED_ACCOUNT_SPACES = {
  protocolConfig: 156,
  arcadeConfig: 103,
  arenaDaily: 235,
  creditVault: 58,
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
  followingDaily: PublicKey;
  creditVault: PublicKey;
}

/**
 * Fail closed before an owner wallet prompt if any exact cadence dependency
 * disappeared, was substituted, or no longer matches the Daily snapshot.
 *
 * The checks intentionally use fixed offsets only for the account identity
 * prefix shared by every valid account revision. Leaderboards live in their
 * own exact-sized accounts and are not entry dependencies.
 */
export async function assertRankedEntryDependencies(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<RankedEntryDependencyValues> {
  const program = zkubeProgram(args.connection as Connection, args.wallet);
  const protocol = deriveProtocolConfigPda();
  const arcadeConfig = deriveArcadeConfigPda();
  const followingDayId = requireFollowingDaily(args.daily);
  const values: RankedEntryDependencyValues = {
    protocol,
    arcadeConfig,
    currentDaily: deriveArenaDailyPda(args.daily.dayId),
    followingDaily: deriveArenaDailyPda(followingDayId),
    creditVault: deriveCreditVaultPda(),
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
      name: "arenaDaily",
      label: "following Daily",
      address: values.followingDaily,
    },
    {
      name: "creditVault",
      label: "credit vault",
      address: values.creditVault,
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
    followingDailyInfo,
    creditVaultInfo,
  ] = exact;

  assertVersion(protocolInfo!, PROTOCOL_ACCOUNT_VERSION, "protocol config");
  assertVersion(arcadeConfigInfo!, ARCADE_ACCOUNT_VERSION, "Arcade config");
  assertVersion(currentDailyInfo!, ARCADE_ACCOUNT_VERSION, "current Daily");
  assertVersion(followingDailyInfo!, ARCADE_ACCOUNT_VERSION, "following Daily");
  assertVersion(creditVaultInfo!, ARCADE_ACCOUNT_VERSION, "credit vault");

  assertPubkeyAt(arcadeConfigInfo!, 9, protocol, "Arcade config protocol");
  assertU64At(
    arcadeConfigInfo!,
    73,
    args.daily.entryLamports,
    "Arcade entry price",
  );
  assertDailyIdentity(currentDailyInfo!, {
    dayId: args.daily.dayId,
    arcadeConfig,
    label: "current Daily",
  });
  assertDailyIdentity(followingDailyInfo!, {
    dayId: followingDayId,
    arcadeConfig,
    label: "following Daily",
  });
  assertPubkeyAt(creditVaultInfo!, 9, protocol, "credit vault protocol");

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
    arcadeConfig: PublicKey;
    label: string;
  },
): void {
  assertU32At(data, 9, expected.dayId, `${expected.label} day`);
  assertPubkeyAt(data, 13, expected.arcadeConfig, `${expected.label} config`);
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
  const protocol = await program.account.protocolConfig.fetch(
    deriveProtocolConfigPda(),
  );
  const content = await dailyContentSelection(dayId);
  const contentVersion = Number(protocol.contentVersion);
  const instruction = await program.methods
    .prepareArenaDaily(dayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arcadeArchive: deriveArcadeArchivePda(),
      realmMapCatalog: deriveMapCatalogPda(contentVersion, content.realmMapId),
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
  scorePayoutCount: number;
  themePayoutCount: number;
}): Promise<TransactionPlan> {
  const scoreBoard = deriveArenaBoardPda(args.daily.address, "score");
  const themeBoard = deriveArenaBoardPda(args.daily.address, "theme");
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.fundedFinalizeArenaDaily(
      args.scorePayoutCount,
      args.themePayoutCount,
    )
    .accountsPartial({
      arenaDaily: args.daily.address,
      followingDaily: deriveArenaDailyPda(requireFollowingDaily(args.daily)),
      scoreBoard,
      themeBoard,
      cadenceFunding: deriveCadenceFundingPda(),
      caller: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return basePlan(
    "Finalize Arena prizes",
    args.connection,
    args.wallet.publicKey,
    [instruction],
  );
}

function requireFollowingDaily(daily: DailyView): number {
  if (daily.followingDayId === null || daily.followingDayId === undefined) {
    throw new Error(
      "DailyNotScheduled: no following paid Daily is prepared to receive this entry or rollover",
    );
  }
  return daily.followingDayId;
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
