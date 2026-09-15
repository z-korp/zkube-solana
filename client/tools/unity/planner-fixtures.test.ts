import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "../../src/backend/solana/idl";
import { CATALOG_VERSION, DAILY_MAX_MOVES } from "../../src/core/protocolVersions.generated";
import { canonicalJson, clientPolicyPath, generatedClientPolicy, generatedPlannerConstants, generatePlannerFixtures, plannerConstantsPath, plannerFixturePath } from "./planner-fixtures";

import { coreDailyPairIndex, coreLadderTierCount } from "../../src/core/zkubeCore";
import { validateEmblemId, validateFrameTier } from "../../src/backend/solana/economy/playerStateClient";
import { MAX_EMBLEM_ID } from "../../src/config/emblems";
import { LADDER_TIERS } from "../../src/config/ladderTiers";
import { dailyContentFromPairIndex } from "../../src/core/dailyRules";
import { canonicalCampaignMap } from "../../src/core/campaignCatalog";
import { repositoryRoot } from "./solana-fixtures";

describe("Unity high-level transaction planner agreement", () => {
  it("regenerates real planners from independent intent and account inputs offline", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected fixture network access"); });
    try {
      const fixture = await generatePlannerFixtures();
      expect(LADDER_TIERS.length).toBe(coreLadderTierCount());
      expect(() => validateEmblemId(MAX_EMBLEM_ID + 1)).toThrow();
      expect(() => validateFrameTier(LADDER_TIERS.length)).toThrow();
      const profiles = (fixture.plans as Array<{
        input: { operation: string; emblem: number; frame: number };
        expected: { ownerRequired: boolean; feePayer: string; deviceSigners: string[]; route: string; versionZero: boolean };
      }>).filter(row => row.input.operation === "featured");
      expect(profiles).toHaveLength((MAX_EMBLEM_ID + 1) * LADDER_TIERS.length);
      expect(new Set(profiles.map(row => row.input.emblem + ":" + row.input.frame)).size).toBe(profiles.length);
      for (const row of profiles) {
        expect(validateEmblemId(row.input.emblem)).toBe(row.input.emblem);
        expect(validateFrameTier(row.input.frame)).toBe(row.input.frame);
        expect(row.expected.ownerRequired).toBe(false);
        expect(row.expected.feePayer).toBe(fixture.inputs.device);
        expect(row.expected.deviceSigners).toEqual([fixture.inputs.device]);
        expect(row.expected.route).toBe("solana-base");
        expect(row.expected.versionZero).toBe(true);
      }
      // Zero-filled omitted fields are not valid publication identities. Decode
      // the actual encoded accounts so a future fixture edit cannot hide this.
      const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
      const nativeRules = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/native-run-trajectories.json"), "utf8"))
        .dailyRulesPublications as Array<{ day: number; rulesHash: number[] }>;
      for (const name of ["daily", "following"] as const) {
        const daily = coder.decode<{ catalogVersion: number; dayId: number; mapId: number; rulesHash: number[]; dailyTheme: { kind: number; value: number }; pressure: { maxMoves: number }; rules: { guardian: unknown; startingRows: number }; opensAt: { toNumber(): number }; runsCloseAt: { toNumber(): number } }>("arenaDaily", Buffer.from(fixture.accounts[name].data, "base64"));
        expect(daily.catalogVersion, name + " catalog").toBe(CATALOG_VERSION);
        const pair = dailyContentFromPairIndex(daily.dayId, await coreDailyPairIndex(daily.dayId));
        const realm = canonicalCampaignMap(CATALOG_VERSION, pair.realmMapId);
        expect(daily.mapId).toBe(pair.realmMapId);
        expect(daily.dailyTheme).toEqual(pair.objective);
        expect(daily.pressure.maxMoves).toBe(DAILY_MAX_MOVES);
        expect(daily.rules.guardian).toEqual(realm.mapRules.guardian);
        expect(daily.rules.startingRows).toBe(realm.mapRules.startingRows);
        const native = nativeRules.filter(value => value.day === daily.dayId);
        expect(native).toHaveLength(1);
        expect(daily.rulesHash, name + " native rules hash").toEqual(native[0]!.rulesHash);
        expect(daily.opensAt.toNumber()).toBe(daily.dayId * 86400);
        expect(daily.runsCloseAt.toNumber()).toBe(daily.dayId * 86400 + 86340);
      }
      const actual = canonicalJson(fixture);
      expect(canonicalJson(await generatePlannerFixtures())).toBe(actual);
      expect(fixture.plans.length).toBeGreaterThan(0);
      for (const [path, content] of [[plannerFixturePath, actual], [plannerConstantsPath, generatedPlannerConstants()], [clientPolicyPath, generatedClientPolicy()]] as const) {
        if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(path) || readFileSync(path, "utf8") !== content)) {
          mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
        }
        expect(readFileSync(path, "utf8"), "Stale planner oracle " + path).toBe(content);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
