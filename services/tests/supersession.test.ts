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
const README = join(ROOT, "README.md");
const CLIENT = join(ROOT, "client/src");
const CLIENT_TOOLS = join(ROOT, "client/tools");
const CLIENT_CONSTRAINT_COPY = [join(CLIENT, "config"), join(CLIENT, "game")];
const CORE = join(ROOT, "crates/zkube-core/src");
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
  {
    pattern:
      /positive thresholds? (?:for|on) (?:perfect[- ]clear|all[- ]block[- ]sizes)|(?:perfect[- ]clear|all[- ]block[- ]sizes).{0,40}positive thresholds?/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "perfect-clear guardian triggers were removed; all-block-sizes carries no numeric threshold",
  },
  {
    pattern:
      /bonus_trigger_type\s*[:=]\s*5\b|bonusTriggerType\s*[:=]\s*5\b|perfect[- ]clears?(?:\s+add\s+\d+\s+and)?\s+(?:earns?|grants?|→).{0,30}(?:Hammer|Totem|Wave|guardian (?:bonus|charge))/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "perfect clear remains a constraint and Arcade reroll grant, never a guardian trigger",
  },
  {
    pattern:
      /two[- ](?:request|vrf).{0,40}perfect[- ]clear|perfect[- ]clear.{0,40}(?:second|two).{0,16}vrf/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one perfect-clear output derives both the board reseed and preview",
  },
  {
    pattern:
      /\bselection_seed\s*:\s*\[u8;\s*32\]|\bselectionSeed\??\s*:\s*Uint8Array/,
    trees: [CLIENT, SERVICES, PROGRAM],
    reversal:
      "the Daily selection seed is protocol code, not catalog or keeper state",
  },
  {
    pattern: /\bdifficulty_band\b|\bdifficultyBand\b/,
    trees: [CLIENT, SERVICES, PROGRAM],
    reversal:
      "Daily uses one catalog-wide pressure profile without per-entry bands",
  },
  {
    pattern: /bonus_trigger_type\s*:\s*3\b|triggerType\s*===?\s*3\b/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "bonus trigger type 3 is unsupported",
  },
  {
    pattern: /KREDIT_PACK_SIZES[^;\n]*\b5\b/,
    trees: [CLIENT],
    reversal: "the shop offers only 1-, 10-, and 25-Kredit packs",
  },
  {
    pattern: /\bpassive_map_id\b|\bpassiveMapId\b|\bpassiveMapCatalog\b/,
    trees: [CLIENT, SERVICES, PROGRAM],
    reversal:
      "Daily has no passive map pairing; Campaign passives stay in Campaign",
  },
  {
    pattern:
      /apply_ladder_streak_bonus|ladder_streak_bonus_pct|ladderStreakBonusPct|LADDER_STREAK_BONUS_CAP_DAYS/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "the visible entry streak does not multiply ladder points",
  },
  {
    pattern:
      /calculate_level_stars|calculateLevelStars|move[- ](?:efficiency|percent(?:age)?) stars|move_(?:efficiency|percent(?:age)?)|move(?:Efficiency|Percent(?:age)?)/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Campaign stars latch from score, primary, and secondary constraints",
  },
  {
    pattern: /star_threshold_modifier|starThresholdModifier|126.{0,3}129/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "Campaign star sources have no authored efficiency modifier",
  },
  {
    pattern: /ComboMeter|Combo Meter/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "Campaign constraints use the fixed line/combo/streak vocabulary",
  },
  {
    pattern: /\bcascade\b/i,
    trees: CLIENT_CONSTRAINT_COPY,
    reversal: "player-facing constraint copy calls the action a combo",
  },
  {
    pattern: /never re-paired/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "guardian pairings are fixed by one Campaign/Arcade catalog publication",
  },
  {
    pattern:
      /Bonus::Reroll|BonusType\.Reroll|\bBonusShape\b|bonus_type\s*==\s*4|RealmPlusUniversalReroll/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Reroll is one universal run action beside the three guardian bonuses",
  },
  {
    pattern: /\breroll_available\b|\brerollAvailable\b|exactly one reroll/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "reroll is a capped inventory with Campaign and Daily grants",
  },
  {
    pattern:
      /(?:starting_(?:bonus_)?charges|bonus_charges)\s*<=\s*15|bonusCharges\s*<=\s*15|\.min\(15\)/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal: "all bonus inventories use the shared three-charge cap",
  },
  {
    pattern:
      /realm_map_id\.max\(1\)|realm_map_id\s*>\s*0|standalone wildcard entry/i,
    trees: [PROGRAM],
    reversal: "every Daily entry pins one real guardian realm",
  },
  {
    pattern: /starting_rows\s*==\s*realm\.starting_rows/,
    trees: [PROGRAM],
    reversal: "the Daily pool entry owns its starting rows, not its realm",
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
    expect(rules).not.toMatch(/once-per-run reroll/i);
  });

  it("keeps the deleted single-reroll model out of public product copy", async () => {
    const readme = await readFile(README, "utf8");
    expect(readme).not.toMatch(/carries one reroll/i);
  });
});
