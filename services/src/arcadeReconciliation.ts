import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";

import {
  accountDiscriminator,
  activeRunPda,
  arenaDailyPda,
  arenaPlayerPda,
  instructionData,
  operatorRevenuePda,
  playerFundingPda,
  playerStatePda,
  runResolutionPda,
  V4_ACCOUNT_VERSION,
  weekStartDay,
  weeklyJackpotPda,
  weeklyPlayerPda,
  ZKUBE_PROGRAM_ID,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";

const INCIDENT_GRACE_SECONDS = 6 * 60 * 60;
const MAX_ACCOUNT_BYTES = 10_240;

interface ProgramAccount {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}

interface ActiveRunView {
  address: PublicKey;
  owner: PublicKey;
  daily: PublicKey;
  runId: bigint;
  mode: number;
  lifecycle: number;
}

interface DailyView {
  address: PublicKey;
  dayId: number;
  weekId: number;
  status: number;
  runsCloseAt: number;
  recoveryDeadlineAt: number;
  entriesPaid: bigint;
  runsFinalized: bigint;
  entriesRefunded: bigint;
  entriesExpired: bigint;
  incidentDeclared: boolean;
  weeklyEligiblePlayers: number;
  weeklyRollups: number;
  winners: PublicKey[];
}

interface ArenaPlayerView {
  address: PublicKey;
  daily: PublicKey;
  owner: PublicKey;
  activeRunId: bigint;
  bestRunId: bigint;
  weeklyRolledUp: boolean;
}

interface WeeklyView {
  address: PublicKey;
  weekId: number;
  status: number;
  closesAt: number;
  winners: PublicKey[];
}

interface WeeklyPlayerView {
  address: PublicKey;
  weekly: PublicKey;
  owner: PublicKey;
}

interface PlayerStateView {
  address: PublicKey;
  owner: PublicKey;
  bestDailyFinish: number;
  bestWeeklyFinish: number;
}

interface ReceiptView {
  address: PublicKey;
  daily: PublicKey;
  owner: PublicKey;
  runId: bigint;
  rentRecipient: PublicKey;
}

/**
 * Discovers only instructions whose complete account relationship can be
 * reconstructed from validated v4 accounts. Governance-only incident refunds
 * are deliberately excluded from the recurring keeper allowlist.
 */
export async function discoverReconciliationPlans(args: {
  connection: Connection;
  keeper: PublicKey;
  nowUnix: number;
}): Promise<KeeperInstructionPlan[]> {
  const raw = await args.connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
    commitment: "confirmed",
  });
  const accounts = raw.map(({ pubkey, account }) => ({
    pubkey,
    account: { ...account, data: Buffer.from(account.data) },
  }));
  accounts.forEach(validateProgramAccount);

  const runs = decodeAll(accounts, "ActiveRun", decodeActiveRun);
  const dailies = decodeAll(accounts, "ArenaDaily", decodeDaily);
  const arenaPlayers = decodeAll(accounts, "ArenaPlayer", decodeArenaPlayer);
  const weeklies = decodeAll(accounts, "WeeklyJackpot", decodeWeekly);
  const weeklyPlayers = decodeAll(accounts, "WeeklyPlayer", decodeWeeklyPlayer);
  const playerStates = decodeAll(accounts, "PlayerState", decodePlayerState);
  const receipts = decodeAll(accounts, "RunResolutionReceipt", decodeReceipt);
  const addresses = new Set(accounts.map(({ pubkey }) => pubkey.toBase58()));
  const dailyByAddress = indexByAddress(dailies);
  const weeklyByAddress = indexByAddress(weeklies);
  const arenaByPair = new Map(
    arenaPlayers.map((player) => [pair(player.daily, player.owner), player]),
  );
  const stateByOwner = new Map(playerStates.map((state) => [state.owner.toBase58(), state]));
  const plans: KeeperInstructionPlan[] = [];
  const terminalPaidRuns = new Set<string>();

  for (const run of runs) {
    if ((run.mode === 0 && ![4, 5].includes(run.lifecycle)) ||
        (run.mode !== 0 && run.lifecycle !== 5)) continue;
    const state = stateByOwner.get(run.owner.toBase58());
    if (!state) continue;
    const funding = playerFundingPda(run.owner);
    if (run.mode === 0) {
      plans.push(plan("consume_terminal_run", "consume_campaign_run", [
        [run.address, true, false], [state.address, true, false],
        [run.owner, false, false], [funding, true, false],
      ], { owner: run.owner, runId: run.runId }));
      continue;
    }
    const daily = dailyByAddress.get(run.daily.toBase58());
    if (!daily) continue;
    const arena = arenaByPair.get(pair(run.daily, run.owner));
    if (run.mode === 1 && arena) {
      terminalPaidRuns.add(`${run.daily.toBase58()}:${run.owner.toBase58()}:${run.runId}`);
      plans.push(plan("consume_terminal_run", "consume_arena_run", [
        [state.address, true, false], [daily.address, true, false],
        [arena.address, true, false], [operatorRevenuePda(), true, false],
        [run.address, true, false], [funding, true, false],
      ], { dayId: daily.dayId, owner: run.owner, runId: run.runId }));
    } else if (run.mode === 2) {
      plans.push(plan("consume_terminal_run", "consume_practice_run", [
        [state.address, true, false], [daily.address, false, false],
        [arena?.address ?? ZKUBE_PROGRAM_ID, false, false],
        [run.address, true, false], [funding, true, false],
      ], { dayId: daily.dayId, owner: run.owner, runId: run.runId }));
    }
  }

  for (const arena of arenaPlayers) {
    if (arena.activeRunId === 0n) continue;
    const daily = dailyByAddress.get(arena.daily.toBase58());
    const state = stateByOwner.get(arena.owner.toBase58());
    if (!daily || !state || daily.incidentDeclared ||
        terminalPaidRuns.has(`${arena.daily.toBase58()}:${arena.owner.toBase58()}:${arena.activeRunId}`) ||
        args.nowUnix < daily.recoveryDeadlineAt + INCIDENT_GRACE_SECONDS) continue;
    const receipt = runResolutionPda(daily.address, arena.owner, arena.activeRunId);
    if (addresses.has(receipt.toBase58())) continue;
    plans.push(plan("expire_stuck_arena_entry", "expire_stuck_arena_entry", [
      [operatorRevenuePda(), true, false], [daily.address, true, false],
      [arena.address, true, false], [state.address, true, false],
      [arena.owner, false, false], [receipt, true, false],
      [SystemProgram.programId, false, false], [args.keeper, true, true],
    ], { dayId: daily.dayId, owner: arena.owner, runId: arena.activeRunId }));
  }

  for (const daily of dailies) {
    const resolved = daily.runsFinalized + daily.entriesRefunded + daily.entriesExpired;
    const weekly = weeklyByAddress.get(weeklyJackpotPda(daily.weekId).toBase58());
    if (daily.status === 0 && args.nowUnix >= daily.runsCloseAt &&
        resolved === daily.entriesPaid && weekly) {
      plans.push(plan("finalize_arena_daily", "finalize_arena_daily", [
        [daily.address, true, false], [weekly.address, true, false],
        [args.keeper, false, true],
        ...daily.winners.map((winner) => [winner, true, false] as MetaRow),
      ], { dayId: daily.dayId, weekId: daily.weekId }));
    }
  }

  for (const arena of arenaPlayers) {
    const daily = dailyByAddress.get(arena.daily.toBase58());
    if (!daily || daily.status !== 1 || arena.bestRunId === 0n || arena.weeklyRolledUp) continue;
    const weekly = weeklyByAddress.get(weeklyJackpotPda(daily.weekId).toBase58());
    if (!weekly || weekly.status !== 0) continue;
    plans.push(plan("rollup_arena_to_weekly", "funded_rollup_arena_to_weekly", [
      [daily.address, true, false], [arena.address, true, false],
      [weekly.address, true, false], [weeklyPlayerPda(weekly.address, arena.owner), true, false],
      [arena.owner, false, false], [playerFundingPda(arena.owner), true, false],
      [args.keeper, false, true], [SystemProgram.programId, false, false],
      [ZKUBE_PROGRAM_ID, false, false],
    ], { dayId: daily.dayId, weekId: daily.weekId, owner: arena.owner }));
  }

  for (const weekly of weeklies) {
    if (weekly.status !== 0 || args.nowUnix < weekly.closesAt) continue;
    const next = weeklyByAddress.get(weeklyJackpotPda(weekly.weekId + 1).toBase58());
    const weekDailies = Array.from({ length: 7 }, (_, offset) =>
      dailyByAddress.get(arenaDailyPda(weekStartDay(weekly.weekId) + offset).toBase58()),
    );
    if (!next || weekDailies.some((daily) => !daily || daily.status !== 1 ||
      daily.weeklyRollups !== daily.weeklyEligiblePlayers)) continue;
    plans.push(plan("finalize_weekly_jackpot", "finalize_weekly_jackpot", [
      [weekly.address, true, false], [next.address, true, false], [args.keeper, false, true],
      ...weekDailies.map((daily) => [daily!.address, false, false] as MetaRow),
      ...weekly.winners.map((winner) => [winner, true, false] as MetaRow),
    ], { weekId: weekly.weekId }));
  }

  for (const daily of dailies.filter((value) => value.status === 1)) {
    daily.winners.forEach((owner, index) => {
      const state = stateByOwner.get(owner.toBase58());
      if (state && (state.bestDailyFinish === 0 || state.bestDailyFinish > index + 1)) {
        plans.push(plan("sync_daily_finish", "sync_daily_finish", [
          [daily.address, false, false], [state.address, true, false], [args.keeper, false, true],
        ], { dayId: daily.dayId, owner }));
      }
    });
  }
  for (const weekly of weeklies.filter((value) => value.status === 1)) {
    weekly.winners.forEach((owner, index) => {
      const state = stateByOwner.get(owner.toBase58());
      if (state && (state.bestWeeklyFinish === 0 || state.bestWeeklyFinish > index + 1)) {
        plans.push(plan("sync_weekly_finish", "sync_weekly_finish", [
          [weekly.address, false, false], [state.address, true, false], [args.keeper, false, true],
        ], { weekId: weekly.weekId, owner }));
      }
    });
  }

  for (const receipt of receipts) {
    const active = activeRunPda(receipt.owner, receipt.runId);
    const daily = dailyByAddress.get(receipt.daily.toBase58());
    if (!addresses.has(active.toBase58()) || !daily) continue;
    plans.push(plan("cleanup_resolved_run", "cleanup_resolved_run", [
      [active, true, false], [receipt.address, true, false],
      [playerFundingPda(receipt.owner), true, false], [receipt.rentRecipient, true, false],
      [args.keeper, false, true],
    ], { dayId: daily.dayId, owner: receipt.owner, runId: receipt.runId, receiptRentRecipient: receipt.rentRecipient }));
  }

  for (const arena of arenaPlayers) {
    const daily = dailyByAddress.get(arena.daily.toBase58());
    if (!daily || daily.status !== 1 || arena.activeRunId !== 0n ||
        (arena.bestRunId !== 0n && !arena.weeklyRolledUp)) continue;
    plans.push(plan("close_arena_player", "close_arena_player", [
      [daily.address, false, false], [arena.address, true, false],
      [playerFundingPda(arena.owner), true, false], [args.keeper, false, true],
    ], { dayId: daily.dayId, owner: arena.owner }));
  }
  for (const player of weeklyPlayers) {
    const weekly = weeklyByAddress.get(player.weekly.toBase58());
    if (!weekly || weekly.status !== 1) continue;
    plans.push(plan("close_weekly_player", "close_weekly_player", [
      [weekly.address, false, false], [player.address, true, false],
      [playerFundingPda(player.owner), true, false], [args.keeper, false, true],
    ], { weekId: weekly.weekId, owner: player.owner }));
  }
  return plans;
}

type MetaRow = [PublicKey, boolean, boolean];
function plan(operation: KeeperInstructionPlan["operation"], name: string, rows: MetaRow[], context: KeeperInstructionPlan["context"]): KeeperInstructionPlan {
  const keys: AccountMeta[] = rows.map(([pubkey, isWritable, isSigner]) => ({ pubkey, isWritable, isSigner }));
  return { operation, context, instruction: new TransactionInstruction({ programId: ZKUBE_PROGRAM_ID, keys, data: instructionData(name) }) };
}

function validateProgramAccount({ pubkey, account }: ProgramAccount): void {
  if (!account.owner.equals(ZKUBE_PROGRAM_ID) || account.executable ||
      account.data.length < 9 || account.data.length > MAX_ACCOUNT_BYTES) {
    throw new Error(`keeper rejects malformed program account ${pubkey.toBase58()}`);
  }
}

function decodeAll<T>(accounts: ProgramAccount[], name: string, decode: (value: ProgramAccount) => T): T[] {
  const discriminator = accountDiscriminator(name);
  return accounts.filter(({ account }) => account.data.subarray(0, 8).equals(discriminator)).map((value) => {
    if (value.account.data[8] !== V4_ACCOUNT_VERSION) throw new Error(`keeper rejects ${name} version`);
    return decode(value);
  });
}

function decodeActiveRun(value: ProgramAccount): ActiveRunView {
  const data = value.account.data;
  const owner = key(data, 9); const runId = data.readBigUInt64LE(73);
  requirePda(value.pubkey, activeRunPda(owner, runId), "ActiveRun");
  return { address: value.pubkey, owner, daily: key(data, 41), runId, mode: data[81]!, lifecycle: data[82]! };
}
function decodeDaily(value: ProgramAccount): DailyView {
  const data = value.account.data; const dayId = data.readUInt32LE(9);
  requirePda(value.pubkey, arenaDailyPda(dayId), "ArenaDaily");
  const count = checkedCount(data, 413, 96, 50, "ArenaDaily entries");
  return { address: value.pubkey, dayId, weekId: data.readUInt32LE(13), status: data[53]!,
    runsCloseAt: safeI64(data, 314), recoveryDeadlineAt: safeI64(data, 322),
    entriesPaid: data.readBigUInt64LE(360), runsFinalized: data.readBigUInt64LE(368),
    entriesRefunded: data.readBigUInt64LE(376), entriesExpired: data.readBigUInt64LE(384),
    incidentDeclared: data[392] === 1, weeklyEligiblePlayers: data.readUInt32LE(405),
    weeklyRollups: data.readUInt32LE(409), winners: Array.from({ length: Math.min(count, 5) }, (_, index) => key(data, 417 + index * 96)) };
}
function decodeArenaPlayer(value: ProgramAccount): ArenaPlayerView {
  const data = value.account.data; const daily = key(data, 9); const owner = key(data, 41);
  requirePda(value.pubkey, arenaPlayerPda(daily, owner), "ArenaPlayer");
  return { address: value.pubkey, daily, owner, activeRunId: data.readBigUInt64LE(89),
    bestRunId: data.readBigUInt64LE(97), weeklyRolledUp: data[157] === 1 };
}
function decodeWeekly(value: ProgramAccount): WeeklyView {
  const data = value.account.data; const weekId = data.readUInt32LE(9);
  requirePda(value.pubkey, weeklyJackpotPda(weekId), "WeeklyJackpot");
  const count = checkedCount(data, 82, 46, 50, "WeeklyJackpot entries");
  return { address: value.pubkey, weekId, status: data[45]!, closesAt: safeI64(data, 54),
    winners: Array.from({ length: Math.min(count, 3) }, (_, index) => key(data, 86 + index * 46)) };
}
function decodeWeeklyPlayer(value: ProgramAccount): WeeklyPlayerView {
  const data = value.account.data; const weekly = key(data, 9); const owner = key(data, 41);
  requirePda(value.pubkey, weeklyPlayerPda(weekly, owner), "WeeklyPlayer");
  return { address: value.pubkey, weekly, owner };
}
function decodePlayerState(value: ProgramAccount): PlayerStateView {
  const data = value.account.data; const owner = key(data, 9);
  requirePda(value.pubkey, playerStatePda(owner), "PlayerState");
  return { address: value.pubkey, owner, bestDailyFinish: data.readUInt16LE(319), bestWeeklyFinish: data.readUInt16LE(321) };
}
function decodeReceipt(value: ProgramAccount): ReceiptView {
  const data = value.account.data; const daily = key(data, 9); const owner = key(data, 41); const runId = data.readBigUInt64LE(73);
  requirePda(value.pubkey, runResolutionPda(daily, owner, runId), "RunResolutionReceipt");
  return { address: value.pubkey, daily, owner, runId, rentRecipient: key(data, 82) };
}
function checkedCount(data: Buffer, offset: number, itemSize: number, maximum: number, label: string): number {
  if (data.length < offset + 4) throw new Error(`keeper rejects short ${label}`);
  const count = data.readUInt32LE(offset);
  if (count > maximum || data.length < offset + 4 + count * itemSize) throw new Error(`keeper rejects invalid ${label}`);
  return count;
}
function safeI64(data: Buffer, offset: number): number {
  const value = data.readBigInt64LE(offset);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("keeper rejects unsafe timestamp");
  return number;
}
function key(data: Buffer, offset: number): PublicKey {
  if (data.length < offset + 32) throw new Error("keeper rejects truncated pubkey");
  return new PublicKey(data.subarray(offset, offset + 32));
}
function requirePda(actual: PublicKey, expected: PublicKey, label: string): void {
  if (!actual.equals(expected)) throw new Error(`keeper rejects noncanonical ${label} PDA`);
}
function pair(left: PublicKey, right: PublicKey): string { return `${left.toBase58()}:${right.toBase58()}`; }
function indexByAddress<T extends { address: PublicKey }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.address.toBase58(), value]));
}
