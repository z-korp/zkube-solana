// @vitest-environment node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Keep the newest twenty reversals, with player-facing and documentation phrases.
// Add at the front and retire the oldest entry; interface names are checked by
// the compiler, IDL drift check and interface lock.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCUMENTS = [join(ROOT, "AGENTS.md"), join(ROOT, "README.md")];
const UNITY = join(ROOT, "unity/Assets/ZKube");
const SOURCE = [UNITY, join(ROOT, "services/src"), join(ROOT, "tools/chain"),
  join(ROOT, "programs/solana/src"), join(ROOT, "crates/zkube-core/src"),
  join(ROOT, "crates/zkube-core-host/src")];
const AUTHORED = [...SOURCE, ...DOCUMENTS];
const SKIPPED = [join(ROOT, "tools/chain/node_modules"), join(ROOT, "tools/chain/idl"),
  join(UNITY, "Generated"), join(UNITY, "Integration/Generated")];
const RULE_LIMIT = 20;
const RULES: Array<{ pattern: RegExp; trees: string[]; reversal: string }> = [
  { pattern: /\bElo\b|keeper-computed rating|K-factor/i, trees: SOURCE,
    reversal: "The cumulative log-rank ladder replaced ratings" },
  { pattern: /full run is what finishes|every change ends with `NO_DNA=1 \.\/validate\.sh` green/i, trees: DOCUMENTS,
    reversal: "Change finishes a commit; release finishes a phase or outgoing artifact" },
  { pattern: /name gate|removes its signing key here|does not immediately revoke that token|preserves the v1 local save format|Pick the name shown with your progress/i, trees: AUTHORED,
    reversal: "One install key and a default name replace rotation and mandatory naming" },
  { pattern: /chain:devnet:|chain:manifest|final manifest|stage mode|activate mode|release:fingerprint|semantic plan validation|fingerprint pins every field checked at runtime|keeper payout export|re-verifies every account closed|post-write account re-read|standalone operator commands/i, trees: AUTHORED,
    reversal: "One workspace, operator bundle and bounded keeper loop own chain operations" },
  { pattern: /\b(?:React|PWA|Capacitor|Vercel|vite|playtest|TWA|Bubblewrap)\b|wallet-standard|twa-manifest|assetlinks|Sol Blocks/i, trees: AUTHORED,
    reversal: "Realms and Arena use the shared Unity pages and native wallet plugin" },
  { pattern: /fixed[ _-]?puzzle|default[ _-]?seed|campaign[ _-]?proof|campaign checkpoint|Campaign run slot|Campaign publication|Campaign delegation|set up (?:this |a |your )?device before (?:a |your )?Campaign trial/i, trees: [...SOURCE, join(ROOT, "README.md")],
    reversal: "Campaign attempts use fresh seeds and synchronize reported progress" },
  { pattern: /Finalization allocates one|exact-sized allocation at finalization|Operator withdrawals remain governance actions|invokes the existing claim instruction|This Daily prize position was already claimed|The Daily prize claim window has closed/i, trees: AUTHORED,
    reversal: "Cadence funds growing boards; purchases pay the team and stale claims are no-ops" },
  { pattern: /Resolving MagicBlock run|Recovering ActiveRun rent|Preparing verified opening|Final tier \d+\/7|Forget run locally|Wake the guardian|still life/i, trees: [UNITY],
    reversal: "Run copy describes player actions instead of internal operations" },
  { pattern: /push(?:ed|es)? automatically|payouts are pushed|push confirms|pushed prize|Everyone who places made money|anything you are still\s+owed is collected automatically|signs every 0\.01 SOL entry|never signs entry payment/i, trees: AUTHORED,
    reversal: "Entries spend prepaid Kredits and prizes use bounded claims" },
  { pattern: /\btomorrow\b/i, trees: [UNITY],
    reversal: "The app does not preview the next Daily" },
  { pattern: /weekly (?:pot|competition)|season (?:pot|competition)|ranked (?:mode|competition)|weekly:current:3SOL/i, trees: [...SOURCE, join(ROOT, "README.md")],
    reversal: "Daily is the only paid competition" },
  { pattern: /positive thresholds? (?:for|on) (?:perfect[- ]clear|all[- ]block[- ]sizes)|(?:perfect[- ]clear|all[- ]block[- ]sizes).{0,40}positive thresholds?|perfect[- ]clears?(?:\s+add\s+\d+\s+and)?\s+(?:earns?|grants?|→).{0,30}(?:Hammer|Totem|Wave|guardian (?:bonus|charge))/i, trees: SOURCE,
    reversal: "Perfect clears grant rerolls and complete triggers carry no threshold" },
  { pattern: /two[- ](?:request|vrf).{0,40}perfect[- ]clear|perfect[- ]clear.{0,40}(?:second|two).{0,16}vrf/i, trees: SOURCE,
    reversal: "One perfect-clear output supplies the reseed and preview" },
  { pattern: /private target curves?|authored move budgets?|per[- ]realm target curves?|1\.0\/1\.5\/2\.0\/2\.5\/3\.0\/3\.5\/4\.0\/4\.5/i, trees: SOURCE,
    reversal: "One target ladder and pressure formula own difficulty" },
  { pattern: /passive\s+(?:pairing|score|scoring|bonus|map|mutator|line-clear|perfect-clear)|neutral baseline|score at ×|perfect clears add|Start with .* (?:Totem|Hammer|Wave)/i, trees: SOURCE,
    reversal: "Realms own guardian rules without score multipliers or starting charges" },
  { pattern: /move[- ](?:efficiency|percent(?:age)?) stars|second star grants|★★ awards|latch in order|contiguous star sources|while holding/i, trees: SOURCE,
    reversal: "Campaign stars latch independently from score and constraints" },
  { pattern: /exactly one reroll|once-per-run reroll|carries one reroll/i, trees: AUTHORED,
    reversal: "Rerolls use a capped inventory with perfect-clear grants" },
  { pattern: /Combo Meter|\bcascade\b|Exact-1|seven families|\bEndless\b/i, trees: [UNITY],
    reversal: "Constraint copy uses the shared line, combo and streak vocabulary" },
  { pattern: /canonical deployed binding|zkube-v4-launch|exactly 17 transactions|archive contract|volume contract|quarantine gates closure/i, trees: AUTHORED,
    reversal: "Fresh bootstrap and the on-chain root replace the abandoned release" },
  { pattern: /\bsim[_-]harness\b|\bapex-reachable\b|\bboard-divergence\b|\bacceptance digest\b/i, trees: AUTHORED,
    reversal: "The retired balance harness supplies no product or operator authority" },
];

async function sourceFiles(dir: string): Promise<string[]> {
  if ((await stat(dir)).isFile()) return [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (SKIPPED.some((skipped) => path.startsWith(skipped))) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(mjs|ts|rs|cs|kt|json|toml|py)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("supersession", () => {
  it("keeps the reversal list bounded so a new rule retires the oldest", () => {
    expect(RULES).toHaveLength(RULE_LIMIT);
    expect(new Set(RULES.map(rule => rule.reversal)).size).toBe(RULE_LIMIT);
  });
  it("keeps reversed models out of authored source", async () => {
    const cache = new Map<string, string[]>();
    const treeFiles = new Map<string, string[]>();
    const violations: string[] = [];
    for (const rule of RULES) {
      const trees = [...new Set(rule.trees)];
      for (const tree of trees) {
        let files = treeFiles.get(tree);
        if (!files) {
          files = await sourceFiles(tree);
          treeFiles.set(tree, files);
        }
        for (const file of files) {
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

});
