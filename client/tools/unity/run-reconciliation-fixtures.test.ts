import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "./solana-fixtures";
import { generateRunReconciliationFixtures, runReconciliationFixturePath } from "./run-reconciliation-fixtures";

describe("Unity run reconciliation agreement", () => {
  it("records native states, actual planners, and the production observer and recovery decisions", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected network"); });
    try {
      const fixture = await generateRunReconciliationFixtures();
      const actual = canonicalJson(fixture);
      expect(canonicalJson(await generateRunReconciliationFixtures())).toBe(actual);
      for (const mode of ["campaign", "daily"]) {
        const pending = fixture.cases.find(value => value.id === `active-${mode}-awaitingVrf`)!;
        const resolved = fixture.cases.find(value => value.id === `active-${mode}-rerolled`)!;
        expect(pending.action[1]).toEqual({ expected: 1, accepted: true, ready: false });
        expect(resolved.action[1]).toEqual({ expected: 1, accepted: true, ready: true });
        expect(fixture.routing.find(value => value.id === `active-${mode}-finished` && !value.delegated)?.phase).toBe("settleable");
        expect(fixture.routing.find(value => value.id === `active-${mode}-rerolled` && value.delegated)?.endpoint).toBe("https://new-er.invalid/");
      }
      if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(runReconciliationFixturePath) || readFileSync(runReconciliationFixturePath, "utf8") !== actual))
        writeFileSync(runReconciliationFixturePath, actual);
      expect(readFileSync(runReconciliationFixturePath, "utf8")).toBe(actual);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
