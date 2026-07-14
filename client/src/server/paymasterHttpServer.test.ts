// @vitest-environment node

import type { AddressInfo } from "node:net";

import { Keypair, type Connection } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPaymasterHttpServer,
  originIsAllowed,
} from "./paymasterHttpServer";

const servers: ReturnType<typeof createPaymasterHttpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("paymaster HTTP service", () => {
  it("accepts only exact and bounded wildcard origins", () => {
    const allowed = ["https://zkube.example", "https://*.vercel.app"];
    expect(originIsAllowed("https://zkube.example", allowed)).toBe(true);
    expect(originIsAllowed("https://preview.vercel.app", allowed)).toBe(true);
    expect(originIsAllowed("https://vercel.app", allowed)).toBe(false);
    expect(originIsAllowed("https://preview.vercel.app.attacker.example", allowed)).toBe(
      false,
    );
    expect(originIsAllowed("http://preview.vercel.app", allowed)).toBe(false);
  });

  it("serves process and cached chain readiness separately", async () => {
    const readiness = vi.fn().mockResolvedValue({ ok: false, error: "wrong cluster" });
    const { endpoint } = await startServer({ readiness });
    await expect(fetch(`${endpoint}/healthz`).then(readBody)).resolves.toEqual({
      status: 200,
      body: { ok: true },
    });
    await expect(fetch(`${endpoint}/readyz`).then(readBody)).resolves.toEqual({
      status: 503,
      body: { ok: false, error: "wrong cluster" },
    });
    await fetch(`${endpoint}/readyz`);
    expect(readiness).toHaveBeenCalledTimes(1);
  });

  it("allows originless workers, rejects untrusted browsers, and handles preflight", async () => {
    const { endpoint, paymaster } = await startServer();
    await expect(fetch(`${endpoint}/api/paymaster`).then(readBody)).resolves.toEqual({
      status: 200,
      body: { pubkey: paymaster.publicKey.toBase58() },
    });
    const rejected = await fetch(`${endpoint}/api/paymaster`, {
      headers: { origin: "https://attacker.example" },
    });
    expect(rejected.status).toBe(403);
    const preflight = await fetch(`${endpoint}/api/paymaster`, {
      method: "OPTIONS",
      headers: { origin: "https://zkube.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://zkube.example",
    );
  });

  it("rejects malformed and oversized JSON before transaction decoding", async () => {
    const { endpoint } = await startServer({ maxBodyBytes: 32 });
    const malformed = await fetch(`${endpoint}/api/paymaster`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(await readBody(malformed)).toEqual({
      status: 400,
      body: { error: "request body must be valid JSON" },
    });
    const oversized = await fetch(`${endpoint}/api/paymaster`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: "x".repeat(40) }),
    });
    expect(await readBody(oversized)).toEqual({
      status: 413,
      body: { error: "request body is too large" },
    });
  });
});

async function startServer(options?: {
  readiness?: () => Promise<{ ok: boolean; error?: string }>;
  maxBodyBytes?: number;
}): Promise<{ endpoint: string; paymaster: Keypair }> {
  const paymaster = Keypair.generate();
  const server = createPaymasterHttpServer({
    dependencies: { keypair: paymaster, connection: {} as Connection },
    allowedOrigins: ["https://zkube.example"],
    readiness: options?.readiness ?? (async () => ({ ok: true })),
    maxBodyBytes: options?.maxBodyBytes,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${address.port}`, paymaster };
}

async function readBody(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: (await response.json()) as unknown };
}
