import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { canonicalJson, repositoryRoot } from "./solana-fixtures";
import { generateSessionDecisionFixtures, generatedSessionViewPolicy } from "./session-decision-fixtures";
import { generateSessionRenewalFixtures } from "./session-renewal-fixtures";
import { generateEconomyFixtures } from "./economy-fixtures";

it("keeps Unity session and commerce inputs bound to actual TypeScript decisions and signed plans", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Fixture generator attempted network access"); });
  try {
    const decisions = canonicalJson(generateSessionDecisionFixtures());
    const renewals = canonicalJson(await generateSessionRenewalFixtures());
    const economy = canonicalJson(await generateEconomyFixtures());
    expect(canonicalJson(generateSessionDecisionFixtures())).toBe(decisions);
    expect(canonicalJson(await generateSessionRenewalFixtures())).toBe(renewals);
    expect(canonicalJson(await generateEconomyFixtures())).toBe(economy);
    for (const [relative, output] of [
      ["fixtures/unity-session-decisions-v1.json", decisions],
      ["fixtures/unity-session-plans-v1.json", renewals],
      ["fixtures/unity-economy-v1.json", economy],
      ["unity/Assets/ZKube/Integration/Client/SessionViewPolicy.g.cs", generatedSessionViewPolicy()],
    ]) {
      const path = resolve(repositoryRoot, relative);
      if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(path) || readFileSync(path, "utf8") !== output)) {
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, output);
      }
      expect(readFileSync(path, "utf8"), `Stale Unity session/economy fixture: ${relative}`).toBe(output);
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
