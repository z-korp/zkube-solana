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
const CORE_WASM = join(ROOT, "crates/zkube-core-wasm/src");
const SERVICES = join(ROOT, "services/src");
const PROGRAM = join(ROOT, "programs/solana/src");

// Generated bindings and the frozen IDL are machine output, not authored text.
const SKIPPED = [
  join(CLIENT, "core/generated"),
  join(CLIENT, "backend/solana/idl"),
];

const RULES: Array<{ pattern: RegExp; trees: string[]; reversal: string }> = [
  {
    pattern: /\bHomePage\b|\bCampaignPage\b/,
    trees: [CLIENT],
    reversal: "Arcade is the one lobby and Map is the one Campaign chooser",
  },
  {
    pattern:
      /\bgridProjection\b|\bEmptyState\b|\bSegmentedTabs\b|\bActionBarSvg\b|\bresolveFeaturedEmblem\b|\busePrizeDeltaTrigger\b|notify-rewards-seen|Wake the guardian|zkube:v4:/i,
    trees: [CLIENT],
    reversal:
      "one engine projection, one rewards observer, and produced client states replaced the dead client surfaces",
  },
  {
    pattern:
      /Resolving MagicBlock run|Recovering ActiveRun rent|Preparing verified opening|Final tier \d+\/7|Forget run locally/i,
    trees: [CLIENT],
    reversal:
      "player-facing run copy names player actions, not protocol plumbing",
  },
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
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
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
    pattern:
      /DAILY_PRESSURE_THRESHOLDS|DAILY_PRESSURE_BLOCK_WEIGHTS|CampaignRules\.block_weights|DailyPressureRules\.block_weights|LevelRuleSnapshot\.block_weights/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one generated tier table and one pressure step replaced stored weight and threshold copies",
  },
  {
    pattern:
      /score_multipliers_x100|scoreMultipliersX100|1\.0\/1\.5\/2\.0\/2\.5\/3\.0\/3\.5\/4\.0\/4\.5/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Daily score pressure is an uncapped formula rather than a stored multiplier array",
  },
  {
    pattern:
      /private target curves?|authored move budgets?|per[- ]realm target curves?/i,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one Campaign target ladder and tier-derived move budgets replaced authored curves",
  },
  {
    pattern: /\bCampaign (?:content )?v2\b|\bcampaign_v2\b/i,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal: "Campaign content v3 replaced the pre-ladder v2 publication",
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
    pattern:
      /\bMutatorRules\b|\bpassive\s+(?:pairing|score|scoring|bonus|map|mutator|line-clear|perfect-clear)\b|line_clear_bonus|perfect_clear_bonus|neutral baseline|Calm Tides|Foundation Stone|Frozen Rage|Marble Discipline|Imperial Scale|Geometric Flow|Bushido|Jungle Altar|Primal Pulse|Altitude/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one Guardian value replaced realm scoring fields and the Daily mode exception",
  },
  {
    pattern:
      /\bscore_multiplier_x100\b|\bcombo_multiplier_x100\b|(?<!["'])\bscoreMultiplierX100\b(?!["'])|\bcomboMultiplierX100\b|PlannerStrongCombo|CampaignCombo|passive[-_]relevance/,
    trees: [CORE, CLIENT, PROGRAM],
    reversal:
      "per-realm scaling fields were inert; pressure owns action scoring",
  },
  {
    pattern:
      /\bsim[_-]harness\b|\bapex-reachable\b|\bPLANNER_STRONG\b|\bORACLE_NODE_BUDGET\b|\bboard-divergence\b|\bacceptance digest\b/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "the Monte Carlo balance harness and its assertion vocabulary were retired",
  },
  {
    pattern:
      /\bderive_randomness\b|\bCAMPAIGN_LEVEL_MODE_TAG\b|OpeningLayout\.hash_blocks/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Campaign stays on the ER and every row comes from a verified VRF output",
  },
  {
    pattern: /\bCampaignSimulation\b|\bDailySimulation\b/,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal: "one Run and one codec drive both gameplay modes",
  },
  {
    pattern:
      /sync_daily_profile|syncDailyProfile|ProfileSynced|profile[- ]sync/i,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal: "a Daily claim atomically settles its payout and profile",
  },
  {
    pattern:
      /seed_launch_pools|seedLaunchPools|top_up_arena_daily|topUpArenaDaily|claim_daily_prize_at_position|ClaimDailyPrizeAtPosition|player_funding_target_lamports|playerFundingTargetLamports/,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one position-addressed claim, one authority deposit, and generated constants replaced duplicate surfaces",
  },
  {
    pattern:
      /player funding PDA|player_funding|playerFunding|funded_prepare_campaign_run|fundedPrepareCampaignRun|funded_enter_arena|fundedEnterArena|withdraw_player_funding|withdrawPlayerFunding|funded_delegate_active_run|fundedDelegateActiveRun|funded_create_player_label|fundedCreatePlayerLabel/,
    trees: [CORE, CORE_WASM, CLIENT, SERVICES, PROGRAM],
    reversal:
      "the owner-funded device session pays player account rent and stored rent_payer receives every refund",
  },
  {
    pattern:
      /archive contract|resultDataBase64|verifyCommittedChain|archive-integrity|quarantin/i,
    trees: [SERVICES],
    reversal:
      "the on-chain rolling root is the archive; no volume contract or quarantine gates closure",
  },
  {
    pattern:
      /archiveDirectory|archiveContractVersion|maximumCadenceResultBytes|materializedInstructionAllowlist|keeperImageDigest/i,
    trees: [SERVICES],
    reversal:
      "the keeper fingerprint retains only fields checked by a runtime path",
  },
  {
    pattern:
      /arcadeEconomy|economy\/payout(?:\.ts)?|webPush|pushSubscriptions|pushServer|prizeNotifier|revoke_expired_session|revokeSessionV2|close_arena_player|closeArenaPlayer/i,
    trees: [SERVICES],
    reversal:
      "the keeper owns cadence and last-resort run recovery only; mirrors, push, and account sweeps were removed",
  },
  {
    pattern: /\bEndless\b|dailyContentSelection/i,
    trees: [CLIENT],
    reversal:
      "Daily pressure names the one competitive profile and the core owns pair selection",
  },
  {
    pattern:
      /connectedPlayerContext|useRunController|\berRetry\b|awaitAccountCondition|RewardsProvider|DailyProvider|CampaignProvider/,
    trees: [CLIENT],
    reversal:
      "the six Effect services and one BackendProvider replaced the client chain-context stack",
  },
  {
    pattern: /\bdevBoard\b|still life/i,
    trees: [CLIENT],
    reversal:
      "the owner play build uses the playable local backend instead of frozen fixtures",
  },
  {
    pattern: /\bRunMetrics\b|\barcade_metrics\b|\bdaily_challenge_bonus\b/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Run persists only state consumed by gameplay, settlement, replay, or presentation",
  },
  {
    pattern: /\brequest_row_vrf\b|\bforce_finish_deadline\b|\babandon_run\b/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "one Run VRF context and one exact finish_run predicate table own the lifecycle",
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
      /second star grants|★★ awards|latch in order|contiguous star sources|while holding/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "star sources latch independently and perfect clears grant rerolls in both modes",
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
    pattern:
      /\bDailyObjective\b|bonus_multiplier_x100|\bscoringIndex\b|\bSurvival\b|Exact-1|seven families/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Daily objectives use the shared constraint vocabulary without multipliers",
  },
  {
    pattern:
      /\bDailyPoolEntry\b|\bDailyRulesCatalog\b|publish_arena_rules|activate_arena_rules|\bdaily pool\b|\brulesCatalog\b|RULES_ACCOUNT_VERSION/i,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "Daily content is the fixed protocol realm-objective product, not a published catalog",
  },
  {
    pattern: /starting_bonus_charges|startingBonusCharges|\bstartingCharges\b/,
    trees: [CORE, CLIENT, SERVICES, PROGRAM],
    reversal:
      "guardian inventories start empty and Daily starting height comes from its realm",
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
    expect(rules).not.toMatch(
      /\bsim[_-]harness\b|\bapex-reachable\b|\bPLANNER_STRONG\b|\bORACLE_NODE_BUDGET\b|\bboard-divergence\b|\bacceptance digest\b/i,
    );
  });

  it("keeps the deleted single-reroll model out of public product copy", async () => {
    const readme = await readFile(README, "utf8");
    expect(readme).not.toMatch(/carries one reroll/i);
  });
});
