import { type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { checkChainReadiness, createDevnetConnection, SOLANA_DEVNET_GENESIS_HASH } from "../src/serviceReadiness.js";

describe("keeper RPC boundary", () => {
  it("requires the Devnet genesis and handles an unavailable RPC", async () => {
    const getGenesisHash = vi.fn().mockResolvedValue(SOLANA_DEVNET_GENESIS_HASH);
    const connection = { getGenesisHash } as unknown as Connection;
    expect(await checkChainReadiness(connection)).toEqual({ ok: true });
    getGenesisHash.mockResolvedValueOnce("another cluster");
    expect((await checkChainReadiness(connection)).ok).toBe(false);
    getGenesisHash.mockRejectedValueOnce(new Error("offline"));
    expect((await checkChainReadiness(connection)).ok).toBe(false);
  });

  it("requires HTTPS outside localhost", () => {
    expect(() => createDevnetConnection({ SOLANA_DEVNET_RPC_URL: "http://example.com" })).toThrow("HTTPS");
    expect(createDevnetConnection({ SOLANA_DEVNET_RPC_URL: "http://localhost:8899" }).rpcEndpoint).toBe("http://localhost:8899");
  });
});
