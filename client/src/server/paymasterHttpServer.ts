import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDevnetPaymasterConnection,
  handlePaymasterRequest,
  paymasterKeypairFromEnv,
  type PaymasterDependencies,
} from "./paymaster.js";
import {
  checkChainReadiness,
  expectedGenesisHashFromEnv,
  type ChainReadinessResult,
} from "./serviceReadiness.js";

const DEFAULT_PORT = 8_080;
const DEFAULT_MAX_BODY_BYTES = 4_096;
const DEFAULT_MAX_CONCURRENT_SUBMISSIONS = 8;
const READINESS_CACHE_MS = 15_000;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://zkube-solana.vercel.app",
  "https://*.vercel.app",
];

interface CachedReadiness extends ChainReadinessResult {
  checkedAt: number;
}

export interface PaymasterHttpServerOptions {
  dependencies: PaymasterDependencies;
  allowedOrigins: string[];
  maxBodyBytes?: number;
  maxConcurrentSubmissions?: number;
  readiness?: () => Promise<ChainReadinessResult>;
  now?: () => number;
}

export function allowedPaymasterOriginsFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const configured = env.PAYMASTER_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

export function originIsAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((allowed) => {
    if (origin === allowed) return true;
    if (!allowed.startsWith("https://*.")) return false;
    try {
      const actual = new URL(origin);
      const suffix = allowed.slice("https://*".length);
      return (
        actual.protocol === "https:" &&
        actual.port === "" &&
        actual.hostname.endsWith(suffix) &&
        actual.hostname.length > suffix.length
      );
    } catch {
      return false;
    }
  });
}

export function createPaymasterHttpServer(options: PaymasterHttpServerOptions): Server {
  const now = options.now ?? Date.now;
  let activeSubmissions = 0;
  let cachedReadiness: CachedReadiness | undefined;
  const readiness =
    options.readiness ??
    (async () =>
      checkChainReadiness({
        connection: options.dependencies.connection,
        expectedGenesisHash:
          options.dependencies.expectedGenesisHash ?? expectedGenesisHashFromEnv(),
      }));

  const server = createServer(async (request, response) => {
    setCommonHeaders(response);
    const pathname = requestPathname(request);
    if (pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (pathname === "/readyz") {
      const checked = await cachedReadinessResult(readiness, cachedReadiness, now);
      cachedReadiness = checked;
      sendJson(
        response,
        checked.ok ? 200 : 503,
        checked.ok ? { ok: true } : { ok: false, error: checked.error },
      );
      return;
    }
    if (pathname !== "/api/paymaster") {
      sendJson(response, 404, { error: "not found" });
      return;
    }

    const origin = singleHeader(request, "origin");
    if (origin) {
      if (!originIsAllowed(origin, options.allowedOrigins)) {
        sendJson(response, 403, { error: "origin is not allowed" });
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    const method = (request.method ?? "GET").toUpperCase();
    if (method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Max-Age", "600");
      response.writeHead(204).end();
      return;
    }
    if (method === "POST") {
      const maximum =
        options.maxConcurrentSubmissions ?? DEFAULT_MAX_CONCURRENT_SUBMISSIONS;
      if (activeSubmissions >= maximum) {
        response.setHeader("Retry-After", "1");
        sendJson(response, 503, { error: "paymaster is busy" });
        return;
      }
      activeSubmissions += 1;
    }

    try {
      const payload =
        method === "POST"
          ? await readJsonBody(request, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
          : null;
      const result = await handlePaymasterRequest(method, payload, options.dependencies);
      sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof HttpPayloadError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        sendJson(response, 500, { error: "paymaster request failed" });
      }
    } finally {
      if (method === "POST") activeSubmissions -= 1;
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export function createConfiguredPaymasterServer(
  env: Record<string, string | undefined> = process.env,
): Server {
  const keypair = paymasterKeypairFromEnv(env);
  const connection = createDevnetPaymasterConnection(env);
  const expectedGenesisHash = expectedGenesisHashFromEnv(env);
  return createPaymasterHttpServer({
    dependencies: {
      keypair,
      connection,
      expectedGenesisHash,
      telemetry: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    },
    allowedOrigins: allowedPaymasterOriginsFromEnv(env),
    maxBodyBytes: positiveInteger(env.PAYMASTER_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    maxConcurrentSubmissions: positiveInteger(
      env.PAYMASTER_MAX_CONCURRENT_SUBMISSIONS,
      DEFAULT_MAX_CONCURRENT_SUBMISSIONS,
    ),
  });
}

async function cachedReadinessResult(
  readiness: () => Promise<ChainReadinessResult>,
  cached: CachedReadiness | undefined,
  now: () => number,
): Promise<CachedReadiness> {
  const current = now();
  if (cached && current - cached.checkedAt < READINESS_CACHE_MS) return cached;
  try {
    const result = await readiness();
    return { ...result, checkedAt: current };
  } catch {
    return { ok: false, error: "readiness check failed", checkedAt: current };
  }
}

async function readJsonBody(request: IncomingMessage, maximum: number): Promise<unknown> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length <= maximum) chunks.push(bytes);
  }
  if (length > maximum) throw new HttpPayloadError(413, "request body is too large");
  if (length === 0) throw new HttpPayloadError(400, "request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpPayloadError(400, "request body must be valid JSON");
  }
}

function requestPathname(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function singleHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function setCommonHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status).end(JSON.stringify(body));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class HttpPayloadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const server = createConfiguredPaymasterServer();
    const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
    server.listen(port, "0.0.0.0", () => {
      process.stdout.write(`${JSON.stringify({ event: "paymaster_listening", port })}\n`);
    });
    const stop = () => {
      server.close((error) => {
        if (error) process.exitCode = 1;
      });
      setTimeout(() => server.closeAllConnections(), 30_000).unref();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "paymaster initialization failed"}\n`,
    );
    process.exitCode = 1;
  }
}
