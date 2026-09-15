import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { produce } from "./local-run-fixtures";
import { coreRunSummary } from "@/core/zkubeCore";

it("actual local backend emits deterministic trajectory and persistence agreement", async () => {
  const output = await produce(resolve(__dirname, "../../.."));
  const campaign = output.cases.find(item => item.name === "campaign-action")!.steps.at(-1) as { persisted: { stars: number[] } };
  expect(campaign.persisted.stars[0], JSON.stringify(output.cases[0].steps.map(step => {
    const value = step as { result: { tokenHex: string } | null };
    if (!value.result) return null;
    const summary = coreRunSummary(Buffer.from(value.result.tokenHex, "hex"));
    return [summary.score, summary.phase, summary.latchedStarSources];
  }))).toBeGreaterThan(0);
  const oldDaily = output.cases.find(item => item.name === "old-daily-completion")!;
  const last = oldDaily.steps.at(-1) as { daily: { id: string }; persisted: { dailyAttempt: { dayId: number; finished: boolean }; bestDailyScore: number } };
  expect(last.daily.id).toBe("2"); expect(last.persisted.dailyAttempt.dayId).toBe(20706); expect(last.persisted.dailyAttempt.finished).toBe(false);
  expect(last.persisted.bestDailyScore).toBeGreaterThan(0);
  const oldCampaign = output.cases.find(item => item.name === "old-campaign-completion")!.steps.at(-1) as { campaign: { id: string } | null };
  expect(oldCampaign.campaign).toBeNull();
  const path = process.env.ZKUBE_LOCAL_RUN_FIXTURE_PATH ?? resolve(__dirname, "../../../fixtures/unity-local-runs-v1.json"), text = JSON.stringify(output, null, 2) + "\n";
  if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(path, text);
  expect(readFileSync(path, "utf8")).toBe(text);
});
