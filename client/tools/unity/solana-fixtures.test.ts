import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson, fixturePath, generatedIdl, generatedIdlPath, generatedSession, generatedSessionPath, generateSolanaFixtures } from "./solana-fixtures";

describe("Unity Solana agreement inputs", () => {
  it("regenerates actual TypeScript planner and decoder output without network access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Fixture generator attempted network access"); });
    try {
      const actual = canonicalJson(await generateSolanaFixtures());
      expect(canonicalJson(await generateSolanaFixtures())).toBe(actual);
      for (const [path, output] of [[fixturePath, actual], [generatedIdlPath, generatedIdl()], [generatedSessionPath, generatedSession()]] as const) {
        if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(path) || readFileSync(path, "utf8") !== output)) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, output);
        }
        expect(readFileSync(path, "utf8"), `Stale Unity fixture: ${path}`).toBe(output);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
