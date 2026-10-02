// Bounded catch-up over the program's Base signatures. The webhook is the
// fast path; this walk is what makes the read model complete: it closes any
// gap a missed or late delivery leaves, a page at a time.

import { ZKUBE_PROGRAM_ID } from "../arcadeChain.js";
import type { D1Like } from "./d1.js";
import { UnreadableTransaction, ingestTransaction, parseTransaction, recordUnreadable, syncState } from "./indexer.js";

export const CATCH_UP_PAGE = 100;
export const CATCH_UP_PAGES_PER_RUN = 2;

export type JsonRpc = (method: string, params: unknown[]) => Promise<unknown>;

/** A JSON-RPC caller for one HTTPS endpoint. */
export function jsonRpc(endpoint: string, fetcher: typeof fetch = fetch): JsonRpc {
  const url = new URL(endpoint);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Solana RPC must use HTTPS, except for localhost");
  }
  return async (method, params) => {
    const response = await fetcher(url.toString(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
    const body = await response.json() as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`RPC ${method} failed: ${String(body.error.message).slice(0, 120)}`);
    return body.result;
  };
}

/**
 * Walks at most a few pages of signatures toward the last complete point.
 * A full page means older history may still be missing: the walk records
 * where it stopped and the model reports itself incomplete until it closes.
 * It never waits on one transaction it cannot read.
 */
export async function catchUp(db: D1Like, rpc: JsonRpc, nowUnix: number): Promise<{ ingested: number; complete: boolean }> {
  let ingested = 0;
  for (let page = 0; page < CATCH_UP_PAGES_PER_RUN; page += 1) {
    const state = await syncState(db);
    const signatures = signaturePage(await rpc("getSignaturesForAddress", [ZKUBE_PROGRAM_ID.toBase58(), {
      limit: CATCH_UP_PAGE, commitment: "confirmed",
      ...(state.gapBefore ? { before: state.gapBefore } : {}),
      ...(state.tip ? { until: state.tip } : {}),
    }]));
    // Oldest first, so an entry is recorded before the run it opens is consumed.
    for (const signature of [...signatures].reverse()) {
      if (await db.prepare("SELECT 1 FROM transactions WHERE signature = ? AND unreadable = 0").bind(signature).first()) continue;
      const transaction = await rpc("getTransaction", [signature,
        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
      if (transaction === null) throw new Error("a listed transaction is not available yet");
      // One transaction the model cannot interpret must not hold every later
      // one back: it is kept as unreadable and the model stays incomplete.
      // Any other failure (the database, above all) is not the transaction's:
      // the walk stops here, advances nothing and reads it again next time.
      try {
        if (await ingestTransaction(db, parseTransaction(transaction))) ingested += 1;
      } catch (error) {
        if (!(error instanceof UnreadableTransaction)) throw error;
        await recordUnreadable(db, signature, Number((transaction as { slot?: unknown }).slot) || 0);
      }
    }
    const newest = state.gapTip ?? signatures[0] ?? state.tip;
    if (signatures.length < CATCH_UP_PAGE) {
      await db.prepare("UPDATE sync SET tip = ?, gap_before = NULL, gap_tip = NULL, caught_up_at = ? WHERE id = 1")
        .bind(newest, nowUnix).run();
      return { ingested, complete: true };
    }
    await db.prepare("UPDATE sync SET gap_before = ?, gap_tip = ? WHERE id = 1")
      .bind(signatures[signatures.length - 1], newest).run();
  }
  return { ingested, complete: false };
}

function signaturePage(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CATCH_UP_PAGE) throw new Error("signature page is malformed");
  return value.map((item) => {
    const signature = (item as { signature?: unknown } | null)?.signature;
    if (typeof signature !== "string" || signature.length > 128) throw new Error("signature page is malformed");
    return signature;
  });
}
