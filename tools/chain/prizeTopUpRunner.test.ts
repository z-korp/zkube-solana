// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parsePrizeTopUpCliArgs, parseTopUpSpec } from "./prizeTopUpRunner.js";

describe("manual prize top-up command", () => {
  it("parses explicit SOL and lamport amounts without floating point", () => {
    expect(parseTopUpSpec("daily:current:1SOL")).toEqual({
      kind: "daily",
      cadence: "current",
      lamports: 1_000_000_000n,
    });
    expect(parseTopUpSpec("daily:following:3.000000001SOL")).toEqual({
      kind: "daily",
      cadence: "following",
      lamports: 3_000_000_001n,
    });
    expect(parseTopUpSpec("daily:737:2500000lamports")).toEqual({
      kind: "daily",
      cadence: 737,
      lamports: 2_500_000n,
    });
  });

  it("rejects ambiguous, zero, over-precise, and overflowing amounts", () => {
    expect(() => parseTopUpSpec("daily:current:1")).toThrow("end in");
    expect(() => parseTopUpSpec("daily:current:0SOL")).toThrow("positive");
    expect(() => parseTopUpSpec("daily:current:0lamports")).toThrow("end in");
    expect(() => parseTopUpSpec("daily:current:1.0000000001SOL")).toThrow(
      "end in",
    );
    expect(() =>
      parseTopUpSpec("daily:current:18446744073709551616lamports"),
    ).toThrow("u64");
  });

  it("uses plan mode by default and preserves repeated typed top-ups", () => {
    const parsed = parsePrizeTopUpCliArgs(
      [
        "--",
        "plan",
        "--top-up",
        "daily:current:1SOL",
        "--top-up",
        "daily:following:3SOL",
        "--manifest",
        "/approved/zkube-v5-devnet.json",
        "--reserve-lamports",
        "100000000",
      ],
      "/workspace/tools/chain",
    );
    expect(parsed.mode).toBe("plan");
    expect(parsed.topUps).toHaveLength(2);
    expect(parsed.authorityReserveLamports).toBe(100_000_000);
    expect(parsed.manifestPath).toBe("/approved/zkube-v5-devnet.json");
  });

  it("never falls back to an abandoned deployment manifest", () => {
    expect(() =>
      parsePrizeTopUpCliArgs(["plan", "--top-up", "daily:current:1SOL"]),
    ).toThrow("requires --manifest");
  });

  it("requires an exact bundle for execute and rejects operation drift", () => {
    expect(() => parsePrizeTopUpCliArgs(["execute"])).toThrow("--bundle");
    expect(() =>
      parsePrizeTopUpCliArgs([
        "execute",
        "--bundle",
        "/tmp/top-up.json",
        "--top-up",
        "daily:current:1SOL",
      ]),
    ).toThrow("reads exact top-ups");
    expect(
      parsePrizeTopUpCliArgs(["execute", "--bundle", "/tmp/top-up.json"]).mode,
    ).toBe("execute");
  });

  it("rejects Mainnet and non-HTTPS RPC overrides", () => {
    expect(() =>
      parsePrizeTopUpCliArgs([
        "--top-up",
        "daily:current:1SOL",
        "--rpc",
        "https://api.mainnet-beta.solana.com",
      ]),
    ).toThrow("never Mainnet");
    expect(() =>
      parsePrizeTopUpCliArgs([
        "--top-up",
        "daily:current:1SOL",
        "--rpc",
        "http://api.devnet.solana.com",
      ]),
    ).toThrow("HTTPS Devnet");
  });
});
