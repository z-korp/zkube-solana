import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "vitest";
import { profileIdentityFixtures, generatedProfileIdentityCatalog, profileIdentityFixturePath, profileIdentityCatalogPath } from "./profile-identity-fixtures";
import { EMBLEM_DESCRIPTORS } from "@/config/emblems";
import { LADDER_TIERS } from "@/config/ladderTiers";
import { coreLadderTierCount } from "@/core/zkubeCore";

test("profile labels and choices follow authored TS metadata and program eligibility", async () => {
  const value = await profileIdentityFixtures();
  expect(await profileIdentityFixtures()).toEqual(value);
  expect(value.emblems.map(row => row.name)).toEqual(EMBLEM_DESCRIPTORS.map(row => row.name));
  expect(value.tiers.map(row => row.name)).toEqual(LADDER_TIERS.map(row => row.name));
  expect(value.tiers).toHaveLength(coreLadderTierCount());
  expect(value.cases).toHaveLength(231);
  for (const [path, content] of [[profileIdentityFixturePath, JSON.stringify(value, null, 2) + "\n"],
    [profileIdentityCatalogPath, generatedProfileIdentityCatalog(value)]]) {
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
    expect(readFileSync(path, "utf8")).toBe(content);
  }
});
