import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson, generateRpcFixtures, rpcFixturePath } from "./rpc-fixtures";

describe("Unity JSON-RPC agreement", () => {
  it("records actual client and web3.js requests without network", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected network"); });
    try {
      const actual = canonicalJson(await generateRpcFixtures());
      expect(canonicalJson(await generateRpcFixtures())).toBe(actual);
      if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(rpcFixturePath) || readFileSync(rpcFixturePath, "utf8") !== actual)) writeFileSync(rpcFixturePath, actual);
      expect(readFileSync(rpcFixturePath, "utf8")).toBe(actual);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
