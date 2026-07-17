import {
  BorshAccountsCoder,
  convertIdlToCamelCase,
} from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants.js";
import { IDL } from "./idl/index.js";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  derivePlayerStatePda,
  derivePlayerFundingPda,
  deriveRunAddresses,
  type RunAddresses,
} from "./pdas.js";

const ACCOUNT_VERSION = 1;
const CODER = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
const ACTIVE_RUN_BYTES = CODER.size("activeRun");

type RecoveryMode = "campaign" | "daily";

export interface OrphanedRunCandidate {
  mode: RecoveryMode;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  dailyChallenge: PublicKey | null;
}

export async function fetchOrphanedRunCandidates(
  connection: Connection,
  maximum = 32,
): Promise<OrphanedRunCandidate[]> {
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
        !isTerminal(mode, lifecycle) ||
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

  const candidates: OrphanedRunCandidate[] = [];
  for (const preliminary of preliminaries.slice(0, maximum)) {
    const keys = consumeRunAccountKeys(preliminary);
    try {
      candidates.push(
        await validateConsumeRunAccountKeys(
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

export function consumeRunAccountKeys(
  candidate: Omit<OrphanedRunCandidate, "dailyChallenge"> & {
    dailyChallenge?: PublicKey | null;
  },
): PublicKey[] {
  const common = [
    candidate.addresses.activeRun,
    derivePlayerStatePda(candidate.owner),
  ];
  if (candidate.mode === "campaign") {
    return [...common, candidate.owner, derivePlayerFundingPda(candidate.owner)];
  }
  const dailyChallenge = candidate.dailyChallenge;
  if (!dailyChallenge) {
    throw new Error("Daily run recovery requires its challenge address");
  }
  return [
    ...common,
    dailyChallenge,
    deriveDailyPlayerPda(dailyChallenge, candidate.owner),
    deriveDailyLeaderboardPda(dailyChallenge),
    candidate.owner,
    derivePlayerFundingPda(candidate.owner),
  ];
}

async function validateConsumeRunAccountKeys(
  connection: Connection,
  mode: RecoveryMode,
  keys: readonly PublicKey[],
): Promise<OrphanedRunCandidate> {
  const expectedCount = mode === "daily" ? 7 : 4;
  if (keys.length !== expectedCount) {
    throw new Error(`${mode} run consumer has an invalid account count`);
  }
  const ownerIndex = mode === "daily" ? 5 : 2;
  const owner = keys[ownerIndex];
  if (!owner || owner.equals(PublicKey.default) || owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("run consumer owner is invalid");
  }
  const programKeyCount = mode === "daily" ? 5 : 2;
  const infos = await connection.getMultipleAccountsInfo(
    [...keys.slice(0, programKeyCount), keys[expectedCount - 1]!],
    "confirmed",
  );
  if (infos.some((info) => info === null)) {
    throw new Error("run consumer account is missing");
  }

  const active = decodeAccount("activeRun", infos[0]!, true);
  const profile = decodeAccount("playerState", infos[1]!, true);
  const runId = bigintField(active, "runId");
  const addresses = deriveRunAddresses(owner, runId);
  requireKey(keys[0], addresses.activeRun, "active run PDA");
  requireKey(keys[1], derivePlayerStatePda(owner), "player state PDA");
  requireKey(publicKeyField(active, "owner"), owner, "active run owner");
  requireKey(publicKeyField(profile, "owner"), owner, "player state owner");
  requireEqualBigint(bigintField(profile, "activeRunId"), runId, "active run pointer");
  if (runId <= 0n) throw new Error("run ID is invalid");
  if (recoveryMode(active) !== mode) {
    throw new Error("run consumer mode is inconsistent");
  }
  const lifecycle = enumName(active.lifecycle);
  if (
    bigintField(active, "finishedAt") <= 0n ||
    bigintField(active, "pendingVrfCounter") !== 0n
  ) {
    throw new Error("active run is not ready for settlement");
  }
  if (!isTerminal(mode, lifecycle)) {
    throw new Error("active run is not terminal");
  }
  const rentInfo = infos[programKeyCount]!;
  if (
    rentInfo.executable ||
    !rentInfo.owner.equals(SystemProgram.programId) ||
    rentInfo.data.length !== 0
  ) {
    throw new Error("player funding PDA is not a zero-data System account");
  }
  requireKey(
    keys[expectedCount - 1],
    derivePlayerFundingPda(owner),
    "player funding PDA",
  );

  if (mode === "campaign") {
    return { mode, owner, runId, addresses, dailyChallenge: null };
  }

  const dailyChallenge = keys[2]!;
  requireKey(publicKeyField(active, "dailyChallenge"), dailyChallenge, "active Daily challenge");
  const challenge = decodeAccount("dailyChallenge", infos[2]!);
  const player = decodeAccount("dailyPlayer", infos[3]!);
  const leaderboard = decodeAccount("dailyLeaderboard", infos[4]!);
  const dayId = numberField(challenge, "dayId");
  requireKey(dailyChallenge, deriveDailyChallengePda(dayId), "Daily challenge PDA");
  requireKey(keys[3], deriveDailyPlayerPda(dailyChallenge, owner), "Daily player PDA");
  requireKey(keys[4], deriveDailyLeaderboardPda(dailyChallenge), "Daily leaderboard PDA");
  requireKey(publicKeyField(player, "challenge"), dailyChallenge, "Daily player challenge");
  requireKey(publicKeyField(player, "player"), owner, "Daily player owner");
  requireKey(publicKeyField(leaderboard, "challenge"), dailyChallenge, "Daily leaderboard challenge");
  return { mode, owner, runId, addresses, dailyChallenge };
}

function decodeAccount(
  name:
    | "activeRun"
    | "playerState"
    | "dailyChallenge"
    | "dailyPlayer"
    | "dailyLeaderboard",
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

function requireKey(actual: PublicKey | undefined, expected: PublicKey, label: string): void {
  if (!actual?.equals(expected)) throw new Error(`${label} is invalid`);
}

function requireEqualBigint(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new Error(`${label} is invalid`);
}
