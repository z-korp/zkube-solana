// One Cloudflare Worker: the public read model and the keeper.
//
// The request path is handed the database and the webhook secret only. The
// keeper's key, its release identity and its pass exist only on the scheduled
// path, which no request can reach.

import { handleRequest } from "./api.js";
import { catchUp, jsonRpc } from "./catchUp.js";
import type { D1Like } from "./d1.js";
import { KEEPER_CRON, runKeeperJob } from "./keeperJob.js";
import { logLine } from "./log.js";
import { SOLANA_DEVNET_GENESIS_HASH, SOLANA_ENDPOINT } from "../../../shared/chain.js";

interface Env extends Record<string, unknown> {
  DB: D1Like;
  CF_VERSION_METADATA?: { id?: string };
}

const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;
/** The values that must never appear in a log, whatever error carries them. */
const SECRET_NAMES = ["KEEPER_SECRET_KEY", "WEBHOOK_SECRET", "SOLANA_DEVNET_RPC_URL"];

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, { db: env.DB, webhookSecret: text(env.WEBHOOK_SECRET) });
  },

  // Two Cron Triggers: the read model's catch-up every minute, and the
  // backstop keeper's pass every ten. Nothing the keeper does is urgent: an
  // entry prepares its own day and a claim finalizes it.
  async scheduled(controller: { cron?: string }, env: Env): Promise<void> {
    const nowMilliseconds = Date.now();
    const variables = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, text(value)]));
    const secrets = SECRET_NAMES.map((name) => variables[name]);
    const print = (event: unknown) => console.log(logLine(event, secrets));
    if (controller.cron === KEEPER_CRON) {
      await runKeeperJob({ db: env.DB, workerVersionId: text(env.CF_VERSION_METADATA?.id), variables }, nowMilliseconds, print);
      return;
    }
    try {
      const rpc = jsonRpc(variables.SOLANA_DEVNET_RPC_URL ?? SOLANA_ENDPOINT);
      // The read model describes one cluster; another cluster's history is not ingested.
      if (await rpc("getGenesisHash", []) !== SOLANA_DEVNET_GENESIS_HASH) throw new Error("RPC genesis does not match Devnet");
      const walked = await catchUp(env.DB, rpc, Math.floor(nowMilliseconds / 1_000));
      print({ event: "indexer_catch_up", ok: true, ...walked });
    } catch (error) {
      print({ event: "indexer_catch_up", ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
    }
  },
};
