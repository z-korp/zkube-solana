import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shareCardText } from "@/ui/components/profile/shareCardText";
import { themeFixtures } from "./theme-fixtures";
import { shareFixtures } from "./share-fixtures";
import { CAMPAIGN_PATHS } from "@/hooks/useMapLayout";
import { dailyThemeName } from "@/core/dailyRules";
import { dailyThemeDescription } from "@/game/constraint";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";

const fixturePath = resolve(__dirname, "../../../fixtures/unity-store-share-v1.json");
const policyPath = resolve(__dirname, "../../../unity/Assets/ZKube/Local/App/ShareNumberFormats.g.cs");
const produced = shareFixtures();
if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") {
  writeFileSync(fixturePath, JSON.stringify(produced.cases, null, 2) + "\n");
  writeFileSync(policyPath, produced.code);
}
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{
  name: string; guardian: string; realm: string; objective: string; total: string; score: number; streak: number; locale: string; expected: string;
}>;
describe("native store shares match the actual ShareCardSheet formatter", () => {
  for (const row of cases) it(row.name + " " + row.locale, () => {
    expect(shareCardText({ displayName: row.name, guardianName: row.guardian, realm: row.realm,
      objective: row.objective, objectiveTotal: BigInt(row.total), dailyScore: row.score, streak: row.streak }, row.locale)).toBe(row.expected);
  });
});
describe("imported page data comes from the existing TypeScript authorities", () => {
  it("exports all authored paths and guardian greetings without hand-copying", () => {
    const catalog = themeFixtures();
    expect(catalog.themes).toHaveLength(10);
    for (const realm of catalog.themes) {
      expect(realm.campaignPath).toEqual(CAMPAIGN_PATHS[realm.realmId - 1]);
      expect(realm.guardianGreeting).toBe(getZoneGuardian(realm.realmId).dailyGreeting);
      expect(realm.guardianPortrait).toBe(getGuardianPortrait(realm.realmId));
      expect(realm.campaignPath).toHaveLength(10);
    }
  });
  it("exports the actual Daily labels and descriptions", () => {
    const catalog = themeFixtures(); expect(catalog.dailyThemes).toHaveLength(16);
    for (const theme of catalog.dailyThemes) {
      expect(theme.name).toBe(dailyThemeName(theme)); expect(theme.description).toBe(dailyThemeDescription(theme));
    }
  });
});
describe("share number policy is generated from actual Intl parts", () => {
  it("keeps all vector outputs and the compact runtime table current", () => {
    expect(cases).toEqual(produced.cases);
    const policy = readFileSync(policyPath, "utf8");
    expect(policy).toBe(produced.code);
  });
});
