// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { logLine } from "../src/worker/log.js";
import { describe, expect, it } from "vitest";

import {
  KEEPER_LIMITS,
  keeperKeypairFromEnv,
  keeperPublicKeyFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
  predictedAccountSpendLamports,
} from "../src/keeper.js";

describe("keeper bounds", () => {
  it("pins reserve and spend limits", () => {
    // A backstop that pays fees and one Daily's rent a pass needs no more.
    expect(KEEPER_LIMITS.reserveLamports).toBe(20_000_000);
    expect(KEEPER_LIMITS.spendLamports).toBe(10_000_000);
    expect(keeperSpendWithinLimit(100_000_000, 100_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(100_000_001, 100_000_000)).toBe(false);
  });

  it("accounts conservatively for fee and rent spend", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(25_005_000);
    expect(predictedAccountSpendLamports(500_000_000, 447_424_160))
      .toBe(52_575_840);
    expect(() => predictedAccountSpendLamports(1, undefined))
      .toThrow("omitted");
    expect(() => predictedKeeperSpendLamports(1, -1, 5_000)).toThrow("invalid lamports");
  });

  it("pins loaded secret material to the configured public key", () => {
    const keeper = Keypair.generate();
    const encoded = JSON.stringify([...keeper.secretKey]);
    expect(keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58() }).publicKey.equals(keeper.publicKey)).toBe(true);
    expect(() => keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() })).toThrow("does not match");
    expect(keeperPublicKeyFromEnv({
      ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58(),
    }).equals(keeper.publicKey)).toBe(true);
  });

  it("a_credential_that_cannot_be_decoded_leaves_nothing_of_itself_in_the_error", () => {
    const keeper = Keypair.generate();
    const bytes = [...keeper.secretKey];
    const marker = "MARKER-7f3a9c";
    // Truncated, quoted, wrong type, wrong length, out of range, and not a key at all.
    for (const malformed of [
      JSON.stringify(bytes).slice(0, 90),
      `[${bytes.slice(0, 40).join(",")},"${marker}"`,
      `${marker}${JSON.stringify(bytes)}`,
      `{"${marker}":${JSON.stringify(bytes)}}`,
      JSON.stringify(bytes.slice(0, 63)),
      JSON.stringify([...bytes.slice(0, 63), 256]),
      JSON.stringify(marker),
    ]) {
      let message = "";
      try { keeperKeypairFromEnv({ KEEPER_SECRET_KEY: malformed, ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58() }); }
      catch (error) { message = String((error as Error).message) + String((error as Error).stack); }
      expect(message).toContain("KEEPER_SECRET_KEY must be a 64-byte JSON array");
      expect(message).not.toContain(marker);
      // No run of the input survives, not even a few digits of it.
      for (let start = 0; start + 8 <= malformed.length; start += 4) {
        expect(message).not.toContain(malformed.slice(start, start + 8));
      }
    }
  });

  it("no_secret_and_no_endpoint_path_or_query_reaches_a_log_line", () => {
    const key = JSON.stringify([...Keypair.generate().secretKey]);
    const rpc = "https://rpc.example.invalid/v2/path-key-123?api-key=query-key-456";
    const secrets = [key, "webhook \"quoted\" secret", rpc, undefined, ""];
    const line = logLine({ event: "keeper_worker", outcome: "pass_failed",
      error: `failed to fetch ${rpc}: ${key} and webhook "quoted" secret; also https://other.invalid/a/b?c=d and http://[bad` },
    secrets);
    for (const leaked of [key, key.slice(1, 40), "path-key-123", "query-key-456", "quoted", "/a/b", "c=d"]) {
      expect(line).not.toContain(leaked);
    }
    expect(JSON.parse(line)).toMatchObject({ event: "keeper_worker", outcome: "pass_failed" });
    expect(line).toContain("other.invalid");
    // An ordinary event is untouched.
    const event = { event: "keeper_pass", ok: true, writes: 2, traceId: "0b8a2f6e-3c1d-4e5f-9a7b-1c2d3e4f5a6b" };
    expect(logLine(event, secrets)).toBe(JSON.stringify(event));
  });

});
