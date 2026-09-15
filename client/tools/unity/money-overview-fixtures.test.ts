import { test, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "./solana-fixtures";
import { generatedMoneyEvidenceData, generateMoneyOverviewFixtures, moneyOverviewDataPath, moneyOverviewFixturePath } from "./money-overview-fixtures";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "../../src/backend/solana/idl/index";
import { coreLadderTier, coreLadderTierFloor } from "../../src/core/zkubeCore";

test("overview evidence encodes a valid product profile while preserving account relationships and boundary oracles", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network in evidence generation"); });
  try {
    const fixture = await generateMoneyOverviewFixtures(), json = JSON.stringify(fixture, null, 2) + "\n";
    expect(JSON.stringify(await generateMoneyOverviewFixtures(), null, 2) + "\n").toBe(json);
    const read = (name: string) => JSON.parse(readFileSync(resolve(repositoryRoot, `fixtures/unity-${name}-v1.json`), "utf8"));
    const [publicCase, ownerCase, pendingCase] = fixture.scenarios;
    expect(publicCase.baseAccounts).toEqual([read("product-reads").accounts.protocol, read("product-reads").accounts.arcade, read("product-reads").accounts.daily]);
    const original = read("run-client").player, player = ownerCase.baseAccounts[3]!;
    expect([player.address, player.owner, player.executable]).toEqual([original.address, original.owner, original.executable]);
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
    const before = coder.decode("playerState", Buffer.from(original.data, "base64"));
    const after = coder.decode("playerState", Buffer.from(player.data, "base64"));
    const changed = new Set(["ladderPoints", "highestLadderTier", "featuredFrameTier", "campaignStars", "lifetimePaidEntries", "entryStreakDays", "lastEntryDayId", "bestDailyScore"]);
    for (const key of Object.keys(before)) if (!changed.has(key)) expect(after[key], key).toEqual(before[key]);
    expect(before.ladderPoints.toString()).toBe("9007199254740993");
    expect(before.highestLadderTier).toBe(3); // Keep the original boundary specimen unchanged.
    const profile = fixture.expectedProfile;
    expect(profile.ladderPoints).toBe(coreLadderTierFloor(1).toString());
    expect(profile.ladderTier).toBe(coreLadderTier(BigInt(profile.ladderPoints)));
    expect(profile.highestTier).toBeGreaterThanOrEqual(profile.ladderTier);
    expect(profile.wornBorder).toBeLessThanOrEqual(profile.highestTier);
    expect(profile.stars).toEqual([...new Array(10).fill(3), ...new Array(90).fill(0)]);
    expect(profile.campaign.map((row: { unlocked: boolean }) => row.unlocked)).toEqual([true, true, ...new Array(8).fill(false)]);
    expect(profile.campaign[0].perfected).toBe(true);
    expect(profile.lastEntryDayId).toBe(read("product-reads").inputs.day);
    expect(BigInt(profile.lifetimePaidEntries)).toBeGreaterThanOrEqual(BigInt(profile.streak));
    expect(ownerCase.baseAccounts.slice(6)).toEqual(read("product-reads").accounts.catalogs);
    expect(ownerCase.erAccounts).toEqual(["campaign", "daily"].map(mode => read("run-client").cases.find((row: { id: string }) => row.id === `active-${mode}-playing`)));
    expect(pendingCase.pending?.transaction).toBe(read("solana").transactions.find((row: { id: string }) => row.id === "purchase-1").signedTransaction);
    expect(fixture.inputs.confirmedFailure).toEqual(read("rpc").cases.find((row: { id: string }) => row.id === "status-confirmed-error").result);
    expect(fixture.inputs.now).toBe(read("product-reads").inputs.now);
    expect(fixture.provenance.sources.every(row => row.sha256.length === 64)).toBe(true);
    const data = generatedMoneyEvidenceData(fixture);
    expect(data).toContain("#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE");
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { writeFileSync(moneyOverviewFixturePath, json); writeFileSync(moneyOverviewDataPath, data); }
    expect(readFileSync(moneyOverviewFixturePath, "utf8")).toBe(json);
    expect(readFileSync(moneyOverviewDataPath, "utf8")).toBe(data);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
