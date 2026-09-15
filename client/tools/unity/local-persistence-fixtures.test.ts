import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { produce } from "./local-persistence-fixtures";
describe("actual local persistence reference", () => {
  it("emits deterministic input and decoder agreement", () => {
    const root = resolve(__dirname, "../../..");
    const text = JSON.stringify(produce(root), null, 2) + "\n";
    expect(JSON.stringify(produce(root), null, 2) + "\n").toBe(text);
    const path = process.env.ZKUBE_LOCAL_FIXTURE_PATH ?? resolve(root, "fixtures/unity-local-product-v1.json");
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(path, text);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});
