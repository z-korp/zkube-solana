// One Cloudflare Worker: the public read model and the keeper.
//
// The request path is handed the database and the webhook secret only. The
// keeper's key, its release identity and its pass exist only on the scheduled
// path, which no request can reach.

import { handleRequest } from "./api.js";
import { catchUp, jsonRpc } from "./catchUp.js";
import type { D1Like } from "./d1.js";
import { runKeeperJob } from "./keeperJob.js";
import { SOLANA_ENDPOINT } from "../../../shared/chain.js";

interface Env extends Record<string, unknown> {
  DB: D1Like;
  CF_VERSION_METADATA?: { id?: string };
}

const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;
const print = (event: unknown) => console.log(JSON.stringify(event));

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, { db: env.DB, webhookSecret: text(env.WEBHOOK_SECRET) });
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const nowMilliseconds = Date.now();
    const variables = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, text(value)]));
    try {
      const walked = await catchUp(env.DB, jsonRpc(variables.SOLANA_DEVNET_RPC_URL ?? SOLANA_ENDPOINT),
        Math.floor(nowMilliseconds / 1_000));
      print({ event: "indexer_catch_up", ok: true, ...walked });
    } catch (error) {
      print({ event: "indexer_catch_up", ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
    }
    await runKeeperJob({ db: env.DB, workerVersionId: text(env.CF_VERSION_METADATA?.id), variables }, nowMilliseconds, print);
  },
};
