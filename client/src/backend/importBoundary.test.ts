// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(new URL("..", import.meta.url));
const SOLANA_BACKEND = join(SOURCE, "backend", "solana");
const TEST_SUPPORT = join(SOURCE, "test");
const FORBIDDEN =
  /^(?:@solana(?:-mobile)?\/|@anchor-lang\/|@magicblock-labs\/|@wallet-standard\/)|(?:^|\/)backend\/solana(?:\/|$)|(?:^|\/)chain(?:\/|$)|(?:^|\/)idl(?:\/|$)/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (path === SOLANA_BACKEND || path === TEST_SUPPORT) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe("backend import boundary", () => {
  it("ui_and_hooks_import_no_chain", () => {
    const violations = sourceFiles(SOURCE).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)]
        .filter((match) => FORBIDDEN.test(match[1]!))
        .map((match) => `${file}:${match[1]}`);
    });
    expect(violations).toEqual([]);
  });
});
