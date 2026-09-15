import { test, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { generatePublicDailyFixtures, publicDailyFixturePath } from "./public-daily-fixtures";
test("actual disconnected TS content and lifecycle produce public Daily evidence", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected network"); });
  try {
    const fixture = await generatePublicDailyFixtures(), text = JSON.stringify(fixture, null, 2) + "\n";
    expect(fixture.cases).toHaveLength(11); expect(fixture.clocks).toHaveLength(6);
    expect(fixture.cases.find(row => row.variant === "open")?.content).not.toBeNull();
    expect(fixture.cases.find(row => row.variant === "suspended-missing")?.content?.suspended).toBe(true);
    expect(JSON.stringify(await generatePublicDailyFixtures(), null, 2) + "\n").toBe(text);
    const path = publicDailyFixturePath;
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(path, text);
    expect(readFileSync(path, "utf8")).toBe(text); expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
