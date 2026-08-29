/**
 * DEV-ONLY in-run board fixtures for the wallet-bypass harness.
 *
 * The play surface was the one screen the harness could not reach: it needs a
 * delegated run in an ER, which needs a wallet, a session and a paid entry, so
 * every board change had to be judged from memory or from a device. This builds
 * an `ActiveRunView` — the exact shape `useRunController` hands back after
 * reading the delegated account — so `PlayScreen`, `GameHud`, `GameBoard` and
 * the action bar all render through their real paths with no test seams.
 *
 * It is a STILL LIFE, deliberately. The board renders and animates, but a move
 * resolves to the same state it started from, because the only honest way to
 * make it play is to drive `zkube-core`'s simulation (the WASM build already
 * exports `playDailySimulationMove` and `playCampaignMove`) and that needs the
 * config/state codecs written on the TS side. Anything cheaper would be the
 * client simulating the game, which is exactly the divergence the chain-grid
 * rule exists to prevent — the harness is for judging the surface, and it must
 * never become a second implementation of the rules.
 */
import { PublicKey } from "@solana/web3.js";

import { BonusType } from "@/chain/bonusTypes";
import {
  CANONICAL_DAILY_PRESSURE,
} from "@/chain/dailyRules";
import {
  CAMPAIGN_CONTENT_VERSION,
  canonicalCampaignMap,
} from "@/chain/campaignCatalog";
import type { ActiveRunRulesView, ActiveRunView } from "@/chain/runPlan";

export type DevBoardMode = "arena" | "campaign";

/** Realm the dev board is played in; 8 is the realm the rest of the fixtures use. */
const DEV_BOARD_MAP_ID = 8;
/** Campaign level, chosen mid-realm so the HUD shows real targets rather than zeroes. */
const DEV_BOARD_LEVEL = 4;

/**
 * A mid-run board, bottom row first.
 *
 * Encoded the way the chain encodes it: a block of width `w` occupies `w`
 * contiguous cells all holding `w`, and 0 is empty. Every row is deliberately
 * short of full — a complete line would have cleared already, so a board
 * carrying one is a state the engine can never produce, and reviewing the
 * surface against an impossible board teaches nothing.
 */
const BOARD_ROWS_BOTTOM_UP: readonly (readonly number[])[] = [
  [4, 4, 4, 4, 3, 3, 3, 0],
  [2, 2, 1, 0, 3, 3, 3, 1],
  [0, 1, 2, 2, 0, 0, 1, 0],
  [0, 0, 0, 4, 4, 4, 4, 0],
  [1, 0, 0, 0, 0, 2, 2, 0],
];

/** The one-row lookahead the whole game's tension hangs on. */
const NEXT_ROW: readonly number[] = [3, 3, 3, 0, 2, 2, 1, 0];

/** Rows bottom-up → the flat 80-cell account layout `toDisplayGrid` reads. */
function encodeGrid(rows: readonly (readonly number[])[]): number[] {
  const cells = Array<number>(80).fill(0);
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, column) => {
      cells[rowIndex * 8 + column] = cell;
    });
  });
  return cells;
}

function campaignRules(): ActiveRunRulesView {
  const map = canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, DEV_BOARD_MAP_ID);
  const level = map.levels[DEV_BOARD_LEVEL - 1]!;
  // The authored catalog, not invented numbers: the HUD's target score, move
  // budget and objective chips are only worth judging at real values.
  return {
    pointsRequired: level.pointsRequired,
    maxMoves: level.maxMoves,
    difficulty: level.difficulty,
    primary: level.primary,
    secondary: level.secondary,
    activeMutatorId: map.mapRules.activeMutatorId,
    passiveMutatorId: map.mapRules.passiveMutatorId,
    bossId: map.mapRules.bossId,
    bonusType: map.mapRules.bonusType,
    bonusTriggerType: map.mapRules.bonusTriggerType,
    bonusThreshold: map.mapRules.bonusThreshold,
  };
}

/**
 * Exactly what `daily_level_rules` builds on chain from the drawn realm and
 * pressure profile: an unreachable points target (the Daily is not a level to
 * clear), the profile's move budget, difficulty zero, and the realm's mutators.
 * Inventing friendlier numbers here would make the HUD lie about the run it is
 * supposed to be showing.
 */
const ARENA_RULES: ActiveRunRulesView = {
  pointsRequired: 0xffff_ffff,
  maxMoves: CANONICAL_DAILY_PRESSURE.maxMoves,
  difficulty: 0,
  primary: { kind: 0, value: 0, requiredCount: 0 },
  secondary: { kind: 0, value: 0, requiredCount: 0 },
  activeMutatorId: DEV_BOARD_MAP_ID,
  passiveMutatorId: 0,
  bossId: 0,
  bonusType: BonusType.Hammer,
  bonusTriggerType: 2,
  bonusThreshold: 4,
};

/**
 * One playable-looking run, in whichever mode the harness asked for.
 *
 * `lifecycle: "playing"` with a non-null next row is what unlocks input, so the
 * board arrives in the state a player actually sees rather than in a loading or
 * awaiting-VRF shell.
 */
export function buildDevActiveRun(
  mode: DevBoardMode,
  owner: PublicKey,
): ActiveRunView {
  const isArena = mode === "arena";
  const nowUnix = Math.floor(Date.now() / 1_000);
  const rules = isArena ? ARENA_RULES : campaignRules();
  // Mid-run, and mid-run against THIS level's own numbers: a fixture score of
  // 18,450 against an authored 54-point target reads as a bug in the HUD when
  // it is only a bug in the fixture.
  const score = isArena ? 18_450 : Math.round(rules.pointsRequired * 0.6);
  const moves = isArena ? 26 : Math.round(rules.maxMoves * 0.45);
  return {
    owner,
    runId: 4_242n,
    mode: isArena ? "daily" : "campaign",
    dailyChallenge: PublicKey.default,
    mapId: DEV_BOARD_MAP_ID,
    level: isArena ? 1 : DEV_BOARD_LEVEL,
    rules,
    lifecycle: "playing",
    // Campaign runs carry no deadline; the Daily's is the 23:59 freeze, far
    // enough out that the harness never opens on a locked board.
    deadlineAt: isArena ? nowUnix + 4 * 3_600 : 0,
    score,
    dailyScore: isArena ? 24_180 : 0,
    pressureScore: isArena ? 1_240 : 0,
    dailyTheme: { kind: 3, value: 2 },
    dailyPressure: CANONICAL_DAILY_PRESSURE,
    actionCounter: moves + 1,
    moves,
    comboCounter: 2,
    maxCombo: 5,
    primaryProgress: Math.min(3, rules.primary.requiredCount),
    secondaryProgress: Math.min(1, rules.secondary.requiredCount),
    latchedStarSources: 0,
    streak: 0,
    chargesEarned: 0,
    levelLinesCleared: 11,
    totalLinesCleared: 11,
    bonusUses: 1,
    currentDifficulty: isArena ? 4 : 3,
    // A run carries exactly one bonus type, and an id outside the enum falls
    // back to "None" — which renders an empty slot that reads as a wiring bug.
    bonusType: rules.bonusType,
    bonusCharges: 2,
    rerollCharges: 1,
    grid: encodeGrid(BOARD_ROWS_BOTTOM_UP),
    nextRow: [...NEXT_ROW],
    pendingVrfCounter: 0,
    vrfRequestCounter: 12,
    endlessThresholds: CANONICAL_DAILY_PRESSURE.thresholds,
    endlessScoreMultipliersX100: CANONICAL_DAILY_PRESSURE.scoreMultipliersX100,
  };
}
