import { test, expect, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateProductReadFixtures, productReadFixturePath, canonicalJson } from "./product-read-fixtures";

test("real TS product reads and rules produce deterministic offline evidence", async () => {
  const network=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw new Error("Unexpected network");});
  try {
    const fixture=await generateProductReadFixtures(), actual=canonicalJson(fixture);
    expect(canonicalJson(await generateProductReadFixtures())).toBe(actual);
    expect(fixture.campaign).toHaveLength(10);
    expect(fixture.boardCases).toHaveLength(10);
    const path=productReadFixturePath;
    if(process.env.ZKUBE_WRITE_UNITY_FIXTURES==="1"&&(!existsSync(path)||readFileSync(path,"utf8")!==actual))writeFileSync(path,actual);
    expect(readFileSync(path,"utf8")).toBe(actual);
    expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
});
