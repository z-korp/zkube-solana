import {
  BorshAccountsCoder,
  convertIdlToCamelCase,
} from "@anchor-lang/core";
import {
  PublicKey,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants.js";
import { IDL } from "./idl/index.js";
import {
  deriveCampaignProgressPda,
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  derivePlayerProfilePda,
  deriveRunAddresses,
  deriveWeeklyStipendPda,
  type RunAddresses,
} from "./pdas.js";

const ACCOUNT_VERSION = 1;
const CODER = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
const ACTIVE_RUN_BYTES = CODER.size("activeRun");

type RecoveryMode = "campaign" | "daily";

export interface OrphanedReceiptCandidate {
  mode: RecoveryMode;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  dailyChallenge: PublicKey | null;
  receiptConsumed: boolean;
}

export async function fetchOrphanedReceiptCandidates(
  connection: Connection,
  maximum = 32,
): Promise<OrphanedReceiptCandidate[]> {
  const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: ACTIVE_RUN_BYTES },
      { memcmp: CODER.memcmp("activeRun") },
    ],
  });
  const preliminaries = accounts.flatMap(({ pubkey, account }) => {
    try {
      const active = decodeAccount("activeRun", account, true);
      const owner = publicKeyField(active, "owner");
      const runId = bigintField(active, "runId");
      const mode = recoveryMode(active);
      const lifecycle = enumName(active.lifecycle);
      if (
        runId <= 0n ||
        (!isTerminal(mode, lifecycle) && lifecycle !== "settled") ||
        bigintField(active, "finishedAt") <= 0n ||
        bigintField(active, "pendingVrfCounter") !== 0n
      ) {
        return [];
      }
      const addresses = deriveRunAddresses(owner, runId);
      if (!addresses.activeRun.equals(pubkey)) return [];
      return [{
        mode,
        owner,
        runId,
        addresses,
        dailyChallenge:
          mode === "daily" ? publicKeyField(active, "dailyChallenge") : null,
      }];
    } catch {
      return [];
    }
  });
  preliminaries.sort(
    (left, right) =>
      Number(left.mode !== "daily") - Number(right.mode !== "daily") ||
      (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0),
  );

  const candidates: OrphanedReceiptCandidate[] = [];
  for (const preliminary of preliminaries.slice(0, maximum)) {
    const keys = consumeReceiptAccountKeys(preliminary);
    try {
      candidates.push(
        await validateConsumeReceiptAccountKeys(
          connection,
          preliminary.mode,
          keys,
        ),
      );
    } catch {
      // Malformed or concurrently changed accounts are never submitted. The
      // next bounded keeper pass re-scans authoritative program state.
    }
  }
  return candidates;
}

export function consumeReceiptAccountKeys(
  candidate: Omit<OrphanedReceiptCandidate, "dailyChallenge" | "receiptConsumed"> & {
    dailyChallenge?: PublicKey | null;
  },
): PublicKey[] {
  const common = [
    candidate.addresses.activeRun,
    candidate.addresses.runShell,
    candidate.addresses.runReceipt,
    derivePlayerProfilePda(candidate.owner),
  ];
  if (candidate.mode === "campaign") {
    return [...common, deriveCampaignProgressPda(candidate.owner), candidate.owner];
  }
  const dailyChallenge = candidate.dailyChallenge;
  if (!dailyChallenge) {
    throw new Error("Daily receipt recovery requires its challenge address");
  }
  return [
    ...common,
    dailyChallenge,
    deriveDailyPlayerPda(dailyChallenge, candidate.owner),
    deriveDailyLeaderboardPda(dailyChallenge),
    deriveWeeklyStipendPda(candidate.owner),
    candidate.owner,
  ];
}

export async function validateConsumeReceiptAccountKeys(
  connection: Connection,
  mode: RecoveryMode,
  keys: readonly PublicKey[],
): Promise<OrphanedReceiptCandidate> {
  const expectedCount = mode === "daily" ? 9 : 6;
  if (keys.length !== expectedCount) {
    throw new Error(`${mode} receipt consumer has an invalid account count`);
  }
  const owner = keys[expectedCount - 1];
  if (!owner || owner.equals(PublicKey.default) || owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("receipt consumer owner is invalid");
  }
  const infos = await connection.getMultipleAccountsInfo(
    keys.slice(0, expectedCount - 1),
    "confirmed",
  );
  if (infos.some((info) => info === null)) {
    throw new Error("receipt consumer account is missing");
  }

  const active = decodeAccount("activeRun", infos[0]!, true);
  const shell = decodeAccount("runShell", infos[1]!, true);
  const receipt = decodeAccount("runReceipt", infos[2]!, true);
  const profile = decodeAccount("playerProfile", infos[3]!);
  const runId = bigintField(active, "runId");
  const addresses = deriveRunAddresses(owner, runId);
  requireKey(keys[0], addresses.activeRun, "active run PDA");
  requireKey(keys[1], addresses.runShell, "run shell PDA");
  requireKey(keys[2], addresses.runReceipt, "run receipt PDA");
  requireKey(keys[3], derivePlayerProfilePda(owner), "player profile PDA");
  requireKey(publicKeyField(active, "owner"), owner, "active run owner");
  requireKey(publicKeyField(active, "runShell"), addresses.runShell, "active run shell");
  requireKey(publicKeyField(shell, "owner"), owner, "run shell owner");
  requireKey(publicKeyField(receipt, "owner"), owner, "run receipt owner");
  requireKey(publicKeyField(receipt, "runShell"), addresses.runShell, "receipt shell");
  requireKey(publicKeyField(profile, "owner"), owner, "player profile owner");
  requireEqualBigint(bigintField(shell, "runId"), runId, "run shell ID");
  requireEqualBigint(bigintField(receipt, "runId"), runId, "run receipt ID");
  if (runId <= 0n) throw new Error("run ID is invalid");
  if (recoveryMode(active) !== mode || enumName(shell.mode) !== mode || enumName(receipt.mode) !== mode) {
    throw new Error("receipt consumer run mode is inconsistent");
  }
  const lifecycle = enumName(active.lifecycle);
  if (
    bigintField(active, "finishedAt") <= 0n ||
    bigintField(active, "pendingVrfCounter") !== 0n
  ) {
    throw new Error("active run is not ready for settlement");
  }
  const receiptConsumed = booleanField(receipt, "consumed");
  if (receiptConsumed) {
    if (lifecycle !== "settled" || enumName(shell.lifecycle) !== "settled") {
      throw new Error("consumed receipt has an unsettled run shell");
    }
    requireBytes(active.actionHash, receipt.actionHash, "consumed action hash");
    requireBytes(active.vrfHash, receipt.vrfHash, "consumed VRF hash");
  } else if (!isTerminal(mode, lifecycle)) {
    throw new Error("active run is not terminal");
  }
  requireBytes(active.rulesHash, shell.rulesHash, "run rules hash");
  requireBytes(active.rulesHash, receipt.rulesHash, "receipt rules hash");

  if (mode === "campaign") {
    requireKey(keys[4], deriveCampaignProgressPda(owner), "campaign progress PDA");
    const campaign = decodeAccount("campaignProgress", infos[4]!);
    requireKey(publicKeyField(campaign, "owner"), owner, "campaign progress owner");
    return { mode, owner, runId, addresses, dailyChallenge: null, receiptConsumed };
  }

  const dailyChallenge = keys[4]!;
  requireKey(publicKeyField(active, "dailyChallenge"), dailyChallenge, "active Daily challenge");
  requireKey(publicKeyField(shell, "dailyChallenge"), dailyChallenge, "run shell Daily challenge");
  const challenge = decodeAccount("dailyChallenge", infos[4]!);
  const player = decodeAccount("dailyPlayer", infos[5]!);
  const leaderboard = decodeAccount("dailyLeaderboard", infos[6]!);
  const stipend = decodeAccount("weeklyStipend", infos[7]!);
  const dayId = numberField(challenge, "dayId");
  requireKey(dailyChallenge, deriveDailyChallengePda(dayId), "Daily challenge PDA");
  requireKey(keys[5], deriveDailyPlayerPda(dailyChallenge, owner), "Daily player PDA");
  requireKey(keys[6], deriveDailyLeaderboardPda(dailyChallenge), "Daily leaderboard PDA");
  requireKey(keys[7], deriveWeeklyStipendPda(owner), "Weekly stipend PDA");
  requireKey(publicKeyField(player, "challenge"), dailyChallenge, "Daily player challenge");
  requireKey(publicKeyField(player, "player"), owner, "Daily player owner");
  requireKey(publicKeyField(leaderboard, "challenge"), dailyChallenge, "Daily leaderboard challenge");
  requireKey(publicKeyField(stipend, "owner"), owner, "Weekly stipend owner");
  return { mode, owner, runId, addresses, dailyChallenge, receiptConsumed };
}

function decodeAccount(
  name:
    | "activeRun"
    | "runShell"
    | "runReceipt"
    | "playerProfile"
    | "campaignProgress"
    | "dailyChallenge"
    | "dailyPlayer"
    | "dailyLeaderboard"
    | "weeklyStipend",
  info: AccountInfo<Buffer>,
  exactSize = false,
): Record<string, unknown> {
  if (info.executable || !info.owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error(`${name} is not a zKube data account`);
  }
  const minimum = CODER.size(name);
  if (
    info.data.length < minimum ||
    (exactSize && info.data.length !== minimum)
  ) {
    throw new Error(`${name} has an invalid data length`);
  }
  const decoded = CODER.decode(name, info.data) as Record<string, unknown>;
  if (numberField(decoded, "version") !== ACCOUNT_VERSION) {
    throw new Error(`${name} has an unsupported version`);
  }
  return decoded;
}

function recoveryMode(active: Record<string, unknown>): RecoveryMode {
  const mode = enumName(active.mode);
  if (mode !== "campaign" && mode !== "daily") {
    throw new Error("run mode is not recoverable");
  }
  return mode;
}

function isTerminal(mode: RecoveryMode, lifecycle: string): boolean {
  return mode === "daily"
    ? lifecycle === "finished"
    : lifecycle === "levelComplete" || lifecycle === "finished";
}

function enumName(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("account enum is malformed");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error("account enum is malformed");
  return keys[0]!;
}

function publicKeyField(record: Record<string, unknown>, field: string): PublicKey {
  const value = record[field];
  if (!(value instanceof PublicKey)) throw new Error(`${field} is malformed`);
  return value;
}

function bigintField(record: Record<string, unknown>, field: string): bigint {
  const value = record[field];
  if (
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    !(typeof value === "object" && value !== null && "toString" in value)
  ) {
    throw new Error(`${field} is malformed`);
  }
  try {
    return BigInt(value.toString());
  } catch {
    throw new Error(`${field} is malformed`);
  }
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = bigintField(record, field);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field} is malformed`);
  return number;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") throw new Error(`${field} is malformed`);
  return value;
}

function requireKey(actual: PublicKey | undefined, expected: PublicKey, label: string): void {
  if (!actual?.equals(expected)) throw new Error(`${label} is invalid`);
}

function requireEqualBigint(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new Error(`${label} is invalid`);
}

function requireBytes(left: unknown, right: unknown, label: string): void {
  const leftBytes = byteArray(left);
  const rightBytes = byteArray(right);
  if (
    !leftBytes ||
    !rightBytes ||
    leftBytes.length !== rightBytes.length ||
    leftBytes.some((value, index) => value !== rightBytes[index])
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function byteArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte))) {
    return value.map(Number);
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  return null;
}
