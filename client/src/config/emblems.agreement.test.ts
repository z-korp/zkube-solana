// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAutoEmblemId, resolveEmblemStates, type EmblemZoneInput } from "./emblems";

interface EligibilityCase {
  id: string;
  packedStars: number[];
  totalStars: number;
  zones: (EmblemZoneInput & { perfected: boolean; levelStars: number[] })[];
  emblemUnlocked: boolean[];
}

const oracle: { schema: number; cases: EligibilityCase[] } = JSON.parse(readFileSync(
  process.env.ZKUBE_PROFILE_ELIGIBILITY_FIXTURE ?? resolve(process.cwd(), "../fixtures/unity-profile-eligibility-v1.json"), "utf8"));

describe("money emblem presentation agrees with the program eligibility oracle", () => {
  it("covers every progression boundary and each sparse guardian record", () => {
    expect(oracle.schema).toBe(1);
    expect(oracle.cases).toHaveLength(231);
    expect(oracle.cases[0]!.zones[0]).toMatchObject({ unlocked: true, cleared: false });
    expect(oracle.cases.find(row => row.id === "stars-1-realm-1-level-9")!.emblemUnlocked[1]).toBe(false);
    expect(oracle.cases.find(row => row.id === "stars-1-realm-1-level-10")!.emblemUnlocked[1]).toBe(true);
  });

  for (const row of oracle.cases) {
    it(row.id, () => {
      const states = resolveEmblemStates(row.zones);
      expect(states.map(state => state.unlocked)).toEqual(row.emblemUnlocked.slice(0, states.length));
      expect(row.emblemUnlocked.slice(states.length).every(unlocked => !unlocked)).toBe(true);
      const auto = resolveAutoEmblemId(row.zones);
      expect(row.emblemUnlocked[auto]).toBe(true);
      expect(auto).toBe(row.emblemUnlocked.lastIndexOf(true));
      for (const state of states.filter(state => state.descriptor.kind === "guardian")) {
        expect(state.gold).toBe(row.zones[state.descriptor.id - 1]!.perfected);
      }
    });
  }
});
