// The Worker's whole inbound surface: public standings, health, and the
// transaction webhook. It is handed the database and the webhook secret and
// nothing else, so no request can start a keeper pass, reach the keeper's
// key or change the write switch.

import { PublicKey } from "@solana/web3.js";

import type { D1Like } from "./d1.js";
import {
  MAX_PAGE_ROWS, MAX_WEBHOOK_TRANSACTIONS, UnreadableTransaction, dayIsFinal, ingestTransaction, modelComplete, parseTransaction, rankOf, standings,
  syncState, type BoardKind,
} from "./indexer.js";

export interface ApiBindings { db: D1Like; webhookSecret: string | undefined }

const MAX_WEBHOOK_BYTES = 2_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" },
});

export async function handleRequest(request: Request, bindings: ApiBindings): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.split("/").filter(Boolean);
  try {
    if (request.method === "POST" && url.pathname === "/v1/webhook") return await webhook(request, bindings);
    if (request.method !== "GET") return json({ error: "not found" }, 404);
    if (url.pathname === "/v1/health") {
      const state = await syncState(bindings.db);
      return json({ complete: modelComplete(state), caughtUpAt: state.caughtUpAt, unreadable: state.unreadable });
    }
    // /v1/days/<day>/boards/<score|theme>[/players/<wallet>]
    if (path[0] !== "v1" || path[1] !== "days" || path[3] !== "boards" || !/^\d{1,10}$/.test(path[2] ?? "") ||
        (path[4] !== "score" && path[4] !== "theme")) return json({ error: "not found" }, 404);
    const dayId = Number(path[2]), kind = path[4] as BoardKind;
    if (dayId > 0xffff_ffff) return json({ error: "not found" }, 404);
    const state = await syncState(bindings.db);
    const shared = { dayId, kind, final: await dayIsFinal(bindings.db, dayId),
      complete: modelComplete(state),
      // The program's board is the leaderboard of record: this is a read model.
      authority: "none" as const };
    if (path.length === 5) {
      const offset = bounded(url.searchParams.get("offset"), 0, 0, 10_000_000);
      const limit = bounded(url.searchParams.get("limit"), 50, 1, MAX_PAGE_ROWS);
      return json({ ...shared, offset, ...await standings(bindings.db, dayId, kind, offset, limit) });
    }
    if (path.length === 7 && path[5] === "players") {
      const found = await rankOf(bindings.db, dayId, kind, wellFormed(() => new PublicKey(path[6]!).toBase58()));
      return found ? json({ ...shared, ...found }) : json({ ...shared, error: "no result" }, 404);
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    return error instanceof BadRequest ? json({ error: "bad request" }, 400) : json({ error: "unavailable" }, 503);
  }
}

class BadRequest extends Error {}
const wellFormed = <T>(read: () => T): T => {
  try { return read(); } catch { throw new BadRequest(); }
};

async function webhook(request: Request, bindings: ApiBindings): Promise<Response> {
  // A shared secret admits a delivery to discovery. It proves nothing about
  // the chain: every row it adds is a hint the catch-up walk also produces.
  if (!bindings.webhookSecret || !sameSecret(request.headers.get("authorization") ?? "", bindings.webhookSecret)) {
    return json({ error: "unauthorized" }, 401);
  }
  const text = await request.text();
  const transactions = wellFormed(() => {
    const payload: unknown = text.length <= MAX_WEBHOOK_BYTES ? JSON.parse(text) : undefined;
    if (!Array.isArray(payload) || payload.length > MAX_WEBHOOK_TRANSACTIONS) throw new BadRequest();
    return payload.map(parseTransaction);
  });
  let ingested = 0;
  for (const transaction of transactions) {
    // A delivery the model cannot interpret is left for the catch-up walk, which records it.
    // A storage failure fails the delivery, so its sender delivers it again.
    try { if (await ingestTransaction(bindings.db, transaction)) ingested += 1; }
    catch (error) { if (!(error instanceof UnreadableTransaction)) throw error; }
  }
  return json({ ingested });
}

function bounded(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback;
  const number = /^\d{1,9}$/.test(value) ? Number(value) : -1;
  if (number < minimum || number > maximum) throw new BadRequest();
  return number;
}

function sameSecret(given: string, expected: string): boolean {
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (given.charCodeAt(index % Math.max(1, given.length)) || 0) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
