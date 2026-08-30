// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = new URL("../", import.meta.url).pathname;

describe("app storage boundary", () => {
  it("storage_has_one_entry_point", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => !path.endsWith("/platform/storage.ts"))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, "utf8").includes("localStorage"))
      .map((path) => relative(SOURCE_ROOT, path));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}
