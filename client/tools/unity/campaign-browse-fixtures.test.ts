import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { campaignBrowseFixturePath, campaignBrowseJson, generateCampaignBrowseFixtures } from "./campaign-browse-fixtures";
test("Campaign browse agrees with actual fetch, node generation and preview rules", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network"); });
  try {
    const fixture = await generateCampaignBrowseFixtures(), json = campaignBrowseJson(fixture);
    expect(campaignBrowseJson(await generateCampaignBrowseFixtures())).toBe(json);
    expect(fixture.cases.map(row => row.id)).toEqual(["attested-progression", "new-player", "first-trial", "saved-local-trial"]);
    for (const row of fixture.cases) { expect(row.expected).toHaveLength(10); for (const map of row.expected) expect(map.levels).toHaveLength(10); }
    expect(fixture.cases[3]!.expected.flatMap(map => map.levels).some(level => level.savedRules && level.state === "playing")).toBe(true);
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(campaignBrowseFixturePath, json);
    expect(readFileSync(campaignBrowseFixturePath, "utf8")).toBe(json);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
