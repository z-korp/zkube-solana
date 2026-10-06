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
  { pattern: /expired before it was sent/i, trees: [UNITY],
    reversal: "An entry that never landed says so on its card, with what is safe and the entry back on its button" },
  { pattern: /Refresh before|Refresh to (?:check|try)|needs? refreshing|Results changed\. Refresh/i, trees: [UNITY],
    reversal: "A stale or absent read restarts by itself; no line asks the player to refresh" },
  { pattern: /Retry settlement|Check settlement before continuing|Settlement could not be confirmed|result is still settling|Daily frozen|New actions are closed|Resume the saved Daily run first/i, trees: [UNITY],
    reversal: "A paid run ends on the shared result page, which says how saving its result stands" },
  { pattern: /Check transaction|transaction needs checking|Check your pending transaction|Check again to confirm|Check this transaction|"View operation"|Solana has not confirmed this yet|Approve the request in your wallet|Purchase pending|Refresh balance/i, trees: [UNITY],
    reversal: "The client follows a sent transaction to its outcome on its own button; nobody is asked to check or refresh and only Last operation shows a receipt" },
  { pattern: /Back to Arcade|refresh Arcade|"Arcade"|How Arcade works|paid Arcade Daily|Your last run today|Your best run on each board counts|Back to rewards|Buy a pack to enter today/,
    trees: [UNITY, join(ROOT, "README.md")],
    reversal: "The paid game has one name on screen, Arena, and one home page: the Daily with one action over today's boards" },
  { pattern: /fee allowance|allowance low|refill allowance|allowance refill|fee refill|device allowance|needs a fee/i, trees: AUTHORED,
    reversal: "What the wallet puts on a device is a deposit that returns, never a fee" },
  { pattern: /Saved Campaign run ·|Rules of your saved run|Campaign information is being checked|Refresh to view Campaign progress|Campaign trial data is unavailable/i, trees: [UNITY],
    reversal: "The Arena Campaign is the Realms Campaign" },
  { pattern: /Daily is being prepared|two Daily preparations|seed\/unpause\/activation|After the window and archival|root-gated closure|skipping a suspended one|activates or calls|whether or not it was activated|funds the following paid Daily|next prepared Daily's opening|lets anyone prepare|first day after (?:it|a suspension)|preparable Daily/i, trees: AUTHORED,
    reversal: "Players' own transactions prepare and finalize each Daily; the keeper is a backstop" },
  { pattern: /\bFly\.io\b|flyctl|FLY_IMAGE_REF|Dockerfile|immutable image|release:deploy|indexing is a separate deployment decision|keeper has no inbound HTTP/i, trees: AUTHORED,
    reversal: "One Cloudflare Worker holds the read model and the keeper, bound to its deployed version" },
  { pattern: /board[ -]chunk|constructs boards|construction adds no funding|each board's sealing|funds exact final rent|Rewards open when this board is sealed/i, trees: AUTHORED,
    reversal: "Consuming a run keeps each board sorted; finalization seals both with their Daily" },
  { pattern: /\bTribal\b/i, trees: AUTHORED,
    reversal: "Realm 9 is Serengeti" },
  { pattern: /board changed|swipe again/i, trees: [UNITY],
    reversal: "A stale queued swipe is dropped without a notice" },
  { pattern: /Edit name|Save name|Name preview|Names can use up to|name starts as Player|editable in Profile|Your name appears on this device/i, trees: AUTHORED,
    reversal: "The platform player account replaces the editable name" },
  { pattern: /\bElo\b|keeper-computed rating|K-factor/i, trees: AUTHORED,
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
