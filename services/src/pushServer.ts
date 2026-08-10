import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  validateSubscription,
  type PushSubscriptionStore,
} from "./pushSubscriptions.js";

/**
 * The keeper's only inbound surface: registering a device for prize
 * notifications.
 *
 * It is deliberately tiny and deliberately unprivileged. It cannot read chain,
 * cannot sign anything, and cannot reach the keeper's signer — the worst a
 * caller can do is add or remove a row in a JSON file, bounded by the store's
 * own caps. Everything it could disclose is already public in a board account.
 *
 * It is also isolated from settlement: a request storm here can slow this
 * server, and the keeper pass is a separate loop that never awaits it.
 */

const MAX_BODY_BYTES = 4_096;
/** Requests per window per address, before the server starts refusing. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

export interface PushServerOptions {
  store: PushSubscriptionStore;
  /** Base64url VAPID public key the client subscribes with. */
  vapidPublicKey: string;
  /** Origins allowed to call this; the deployed client, and nothing else. */
  allowedOrigins: readonly string[];
  port: number;
  log?: (event: Record<string, unknown>) => void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["fly-client-ip"] ??
    request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value ?? request.socket.remoteAddress ?? "unknown").split(",")[0]!.trim();
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // Refuse rather than buffer: this endpoint has no reason to see 4KB.
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createPushServer(options: PushServerOptions): Server {
  const log = options.log ?? (() => {});
  const buckets = new Map<string, Bucket>();
  const allowed = new Set(options.allowedOrigins);

  const rateLimited = (request: IncomingMessage, now: number): boolean => {
    const key = clientAddress(request);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      // Bounded memory: the map is swept whenever it grows past a sane size.
      if (buckets.size > 10_000) {
        for (const [address, entry] of buckets) {
          if (entry.resetAt <= now) buckets.delete(address);
        }
      }
      return false;
    }
    bucket.count += 1;
    return bucket.count > RATE_LIMIT;
  };

  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
    origin: string | undefined,
  ): void => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (origin && allowed.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "content-type";
      headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
      headers["Access-Control-Max-Age"] = "86400";
    }
    response.writeHead(status, headers);
    response.end(JSON.stringify(body));
  };

  return createServer((request, response) => {
    void (async () => {
      const origin = request.headers.origin;
      const url = new URL(request.url ?? "/", "http://keeper.invalid");
      if (request.method === "OPTIONS") {
        send(response, 204, {}, origin);
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { ok: true }, origin);
        return;
      }
      if (request.method === "GET" && url.pathname === "/push/config") {
        send(response, 200, { vapidPublicKey: options.vapidPublicKey }, origin);
        return;
      }
      if (rateLimited(request, Date.now())) {
        send(response, 429, { error: "rate_limited" }, origin);
        return;
      }
      if (request.method !== "POST") {
        send(response, 404, { error: "not_found" }, origin);
        return;
      }

      const raw = await readBody(request);
      if (raw === null) {
        send(response, 413, { error: "too_large" }, origin);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        send(response, 400, { error: "invalid_json" }, origin);
        return;
      }

      if (url.pathname === "/push/subscribe") {
        const record = validateSubscription(parsed);
        if (!record) {
          send(response, 400, { error: "invalid_subscription" }, origin);
          return;
        }
        const outcome = await options.store.add(record);
        log({ event: "push_subscribe", outcome, owner: record.owner });
        send(
          response,
          outcome === "added" ? 201 : 507,
          { outcome },
          origin,
        );
        return;
      }

      if (url.pathname === "/push/unsubscribe") {
        const endpoint = (parsed as { endpoint?: unknown }).endpoint;
        if (typeof endpoint !== "string" || endpoint.length > 1_024) {
          send(response, 400, { error: "invalid_endpoint" }, origin);
          return;
        }
        const removed = await options.store.removeEndpoints([endpoint]);
        log({ event: "push_unsubscribe", removed });
        send(response, 200, { removed }, origin);
        return;
      }

      send(response, 404, { error: "not_found" }, origin);
    })().catch(() => {
      // Never leak an internal error shape to an unauthenticated caller.
      try {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "internal" }));
      } catch {
        // response already closed
      }
    });
  });
}
