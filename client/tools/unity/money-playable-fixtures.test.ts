import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { generateMoneyPlayableFixtures, generatedMoneyPlayableData, moneyPlayableDataPath, moneyDailyPlayableFixturePath } from "./money-playable-fixtures";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "../../src/backend/solana/idl";

test("finite Daily evidence use native trajectories, actual TS plans and product reads", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network in playable fixture production"); });
  try {
    const daily = await generateMoneyPlayableFixtures();
    expect(await generateMoneyPlayableFixtures()).toEqual(daily);
    expect(daily.terminal).toEqual({ phase: "finished", score: 139, latchedStarSources: 0, usedBonus: true });
    expect(daily.daily).toEqual({ score: 139, theme: "13", qualifyingPoints: 200, followingContribution: "9000000", kreditsBefore: "25", kreditsAfter: "24", streakAfter: 1 });
    expect(daily.campaign.after).toEqual(daily.campaign.before);
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
    const before = coder.decode("playerState", Buffer.from(daily.transport.playerBefore.data, "base64"));
    const after = coder.decode("playerState", Buffer.from(daily.transport.playerAfter.data, "base64"));
    expect(before.activeRunId.toString()).toBe("0"); expect(after.activeRunId.toString()).toBe("0");
    expect(after.nextRunId.sub(before.nextRunId).toString()).toBe("1");
    expect(after.kreditBalance.sub(before.kreditBalance).toString()).toBe("-1");
    expect(after.lifetimePaidEntries.sub(before.lifetimePaidEntries).toString()).toBe("1");
    expect(after.ladderPoints.sub(before.ladderPoints).toString()).toBe("200");
    expect(network).not.toHaveBeenCalled();
    const dailyJson = JSON.stringify(daily, null, 2) + "\n", data = generatedMoneyPlayableData(daily);
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { writeFileSync(moneyDailyPlayableFixturePath, dailyJson); writeFileSync(moneyPlayableDataPath, data); }
    expect(readFileSync(moneyPlayableDataPath, "utf8")).toBe(data);
    expect(readFileSync(moneyDailyPlayableFixturePath, "utf8")).toBe(dailyJson);
  } finally { network.mockRestore(); }
});
