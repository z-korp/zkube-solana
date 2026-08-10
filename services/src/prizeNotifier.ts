import { Buffer } from "node:buffer";
import type { Connection, PublicKey } from "@solana/web3.js";

import { arenaBoardPda, arenaDailyPda, type DailyBoardKind } from "./arcadeChain.js";
import type { PushSubscriptionStore } from "./pushSubscriptions.js";
import { sendPush, type VapidKeys } from "./webPush.js";

/**
 * Tell winners they have been paid, from an entirely read-only pass.
 *
 * Deliberately decoupled from the write path. It re-reads the boards rather
 * than being handed winners by the reconciliation, so a push outage, a wedged
 * push service or a corrupt subscription file can never fail a settlement pass
 * — the worst it can do is leave a notification unsent, and the reward stays
 * claimable in the app regardless.
 *
 * A notification is a courtesy on top of the collect band, not the mechanism.
 */

const HEADER_BYTES = 129;
const ENTRY_BYTES = 84;
const BOARD_CAPACITY = 1_536;
const PAYOUT_UNIT = 1_000_000n;
const RANK_WEIGHT_SCALE = 0xffff_ffff_ffff_ffffn;
/** Days back to consider; a board's claim window is far longer, but a
 *  notification about a four-day-old prize is noise, not news. */
export const NOTIFY_LOOKBACK_DAYS = 3;
/** Ceiling per pass, so a backlog can never become a push storm. */
export const MAX_NOTIFICATIONS_PER_PASS = 200;

export interface NotifiedBoardStore {
  /** Board keys already notified, as `dayId:kind`. */
  read(): Promise<string[]>;
  write(keys: readonly string[]): Promise<void>;
}

export interface PrizeNotifierResult {
  boards: number;
  sent: number;
  pruned: number;
}

function rankWeight(rank: number): bigint {
  return RANK_WEIGHT_SCALE / BigInt(rank);
}

/** The program's own payout maths: floor to the SOL payout unit. */
function payoutForRank(pool: bigint, denominator: bigint, rank: number): bigint {
  if (denominator === 0n) return 0n;
  return ((pool * rankWeight(rank)) / (denominator * PAYOUT_UNIT)) * PAYOUT_UNIT;
}

interface SealedBoard {
  key: string;
  winners: Array<{ owner: string; rank: number; amountLamports: bigint }>;
}

function decodeSealedBoard(
  data: Buffer,
  dayId: number,
  kind: DailyBoardKind,
): SealedBoard | null {
  if (data.length < HEADER_BYTES) return null;
  if (data.readUInt8(8) === 0) return null;
  if (data.readUInt32LE(41) !== dayId) return null;
  if (data.readUInt8(45) !== (kind === "score" ? 0 : 1)) return null;
  const payoutCount = data.readUInt32LE(54);
  const denominator =
    data.readBigUInt64LE(58) | (data.readBigUInt64LE(66) << 64n);
  const pool = data.readBigUInt64LE(74);
  const cursor = data.readUInt32LE(99);
  const sealed = data.readUInt8(103) !== 0;
  const bitmapBytes = Math.ceil(payoutCount / 8);
  const rowsEnd = HEADER_BYTES + payoutCount * ENTRY_BYTES;
  if (
    !sealed ||
    payoutCount === 0 ||
    payoutCount > BOARD_CAPACITY ||
    cursor !== payoutCount ||
    denominator === 0n ||
    data.length !== rowsEnd + 2 * bitmapBytes
  ) {
    return null;
  }
  const winners = Array.from({ length: payoutCount }, (_, index) => {
    const offset = HEADER_BYTES + index * ENTRY_BYTES;
    return {
      owner: bs58Encode(data.subarray(offset, offset + 32)),
      rank: index + 1,
      amountLamports: payoutForRank(pool, denominator, index + 1),
    };
  }).filter((winner) => winner.amountLamports > 0n);
  return { key: `${dayId}:${kind}`, winners };
}

const BS58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 so the notifier can key subscriptions without web3 objects. */
function bs58Encode(bytes: Buffer): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BS58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const milli = (lamports % 1_000_000_000n) / 1_000_000n;
  return `${whole}.${milli.toString().padStart(3, "0")}`;
}

/**
 * One notification pass: read recently sealed boards, tell every subscribed
 * winner once, and prune endpoints the push service has retired.
 */
export async function runPrizeNotifier(args: {
  connection: Pick<Connection, "getMultipleAccountsInfo">;
  subscriptions: PushSubscriptionStore;
  notified: NotifiedBoardStore;
  vapid: VapidKeys;
  currentDayId: number;
  fetchImpl?: typeof fetch;
}): Promise<PrizeNotifierResult> {
  const alreadyNotified = new Set(await args.notified.read());
  const candidates: Array<{
    dayId: number;
    kind: DailyBoardKind;
    address: PublicKey;
  }> = [];
  for (let back = 0; back <= NOTIFY_LOOKBACK_DAYS; back += 1) {
    const dayId = args.currentDayId - back;
    if (dayId < 0) continue;
    const daily = arenaDailyPda(dayId);
    for (const kind of ["score", "theme"] as const) {
      if (alreadyNotified.has(`${dayId}:${kind}`)) continue;
      candidates.push({ dayId, kind, address: arenaBoardPda(daily, kind) });
    }
  }
  if (candidates.length === 0) return { boards: 0, sent: 0, pruned: 0 };

  const infos = await args.connection.getMultipleAccountsInfo(
    candidates.map(({ address }) => address),
    "confirmed",
  );
  const boards = candidates.flatMap((candidate, index) => {
    const info = infos[index];
    if (!info) return [];
    const board = decodeSealedBoard(
      Buffer.from(info.data),
      candidate.dayId,
      candidate.kind,
    );
    return board ? [board] : [];
  });
  if (boards.length === 0) return { boards: 0, sent: 0, pruned: 0 };

  const owners = [...new Set(boards.flatMap((board) =>
    board.winners.map((winner) => winner.owner)))];
  const targets = await args.subscriptions.forOwners(owners);
  const byOwner = new Map<string, typeof targets>();
  for (const target of targets) {
    byOwner.set(target.owner, [...(byOwner.get(target.owner) ?? []), target]);
  }

  const retired: string[] = [];
  let sent = 0;
  for (const board of boards) {
    for (const winner of board.winners) {
      for (const target of byOwner.get(winner.owner) ?? []) {
        if (sent >= MAX_NOTIFICATIONS_PER_PASS) break;
        const payload = Buffer.from(
          JSON.stringify({
            title: `You won ${formatSol(winner.amountLamports)} SOL`,
            body: `Rank #${winner.rank} on the ${board.key.endsWith("score") ? "Score" : "Theme"} board. Open zKube to collect.`,
            tag: `zkube-prize-${board.key}`,
            url: "/",
          }),
          "utf8",
        );
        const outcome = await sendPush({
          target,
          payload,
          vapid: args.vapid,
          fetchImpl: args.fetchImpl,
        });
        if (outcome === "gone") retired.push(target.endpoint);
        if (outcome === "sent") sent += 1;
      }
    }
  }

  const pruned = await args.subscriptions.removeEndpoints(retired);
  // A board is marked done even when nobody was subscribed: the alternative is
  // re-reading and re-deciding it on every pass forever.
  await args.notified.write([
    ...[...alreadyNotified].slice(-64),
    ...boards.map((board) => board.key),
  ]);
  return { boards: boards.length, sent, pruned };
}
