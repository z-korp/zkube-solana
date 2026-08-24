// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Reversed decisions leave vocabulary behind: copy, comments, and helpers
// that describe the dead model read as intent to rebuild it. Each entry here
// names a reversal and the phrases that may never reappear in source. A
// reversal is not complete until its phrases are on this list.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AGENT_RULES = join(ROOT, "AGENTS.md");
const CLIENT = join(ROOT, "client/src");
const CLIENT_TOOLS = join(ROOT, "client/tools");
const SERVICES = join(ROOT, "services/src");
const PROGRAM = join(ROOT, "programs/solana/src");

// Generated bindings and the frozen IDL are machine output, not authored text.
const SKIPPED = [join(CLIENT, "core/generated"), join(CLIENT, "chain/idl")];

const RULES: Array<{ pattern: RegExp; trees: string[]; reversal: string }> = [
  {
    pattern:
      /push(?:ed|es)? automatically|payouts are pushed|push confirms|pushed prize/i,
    trees: [CLIENT, SERVICES, PROGRAM],
    reversal: "settlement is claim-based (2026-08-08); nothing is pushed",
  },
  {
    pattern: /\btomorrow\b/i,
    trees: [CLIENT],
    reversal:
      "the next day's content is unpublished (2026-08-10); no surface hints at it",
  },
  {
    pattern: /\bweekly\b|\bseason\b/i,
    trees: [CLIENT, PROGRAM],
    reversal: "Daily is the only competition; Weekly and Season died with v4",
  },
  {
    pattern: /weekly:current:3SOL/i,
    trees: [CLIENT_TOOLS],
    reversal: "the manual top-up surface is Daily-only",
  },
  {
    pattern: /devnet-v4\.json/i,
    trees: [CLIENT, CLIENT_TOOLS],
    reversal: "the abandoned deployment record is never a v5 runtime default",
  },
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (SKIPPED.some((skipped) => path.startsWith(skipped))) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|rs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("supersession", () => {
  it("keeps reversed models out of authored source", async () => {
    const cache = new Map<string, string[]>();
    const violations: string[] = [];
    for (const rule of RULES) {
      for (const tree of rule.trees) {
        for (const file of await sourceFiles(tree)) {
          let lines = cache.get(file);
          if (!lines) {
            lines = (await readFile(file, "utf8")).split("\n");
            cache.set(file, lines);
          }
          lines.forEach((line, index) => {
            if (rule.pattern.test(line)) {
              violations.push(`${file}:${index + 1} — ${rule.reversal}`);
            }
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps abandoned deployment language out of operator procedures", async () => {
    const rules = await readFile(AGENT_RULES, "utf8");
    expect(rules).not.toMatch(/canonical deployed binding/i);
    expect(rules).not.toMatch(/weekly:current:3SOL/i);
  });
});
