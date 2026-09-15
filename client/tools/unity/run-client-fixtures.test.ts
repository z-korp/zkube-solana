import { test, expect, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateRunClientFixtures, runClientFixturePath } from "./run-client-fixtures";

test("encodes the Arcade slot and invokes actual native TS decoding and recovery", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected network"); });
  try {
    const fixture = await generateRunClientFixtures();
    const actual = JSON.stringify(fixture, null, 2) + "\n";
    expect(JSON.stringify(await generateRunClientFixtures(), null, 2) + "\n").toBe(actual);
    expect(new Set(fixture.cases.map(row => row.address)).size).toBe(1);
    expect(fixture.routing.every(row => row.phase === "delegated")).toBe(true);
    expect(fixture.sessionDecisions).toHaveLength(5);
    expect(fixture.sessionDecisions.every(row => row.phase === "settleable")).toBe(true);
    expect(Object.keys(fixture.deviceConsume)).toEqual(["daily"]);
    const path = process.env.ZKUBE_STAGED_RUN_FIXTURE ?? runClientFixturePath;
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1" && (!existsSync(path) || readFileSync(path, "utf8") !== actual)) writeFileSync(path, actual);
    expect(readFileSync(path, "utf8")).toBe(actual);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
