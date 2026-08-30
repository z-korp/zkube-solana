/** DEV-only playable board driven by the same core `Run` as connected play. */
import { PublicKey } from "@solana/web3.js";

import { BonusType } from "@/chain/bonusTypes";
import {
  CANONICAL_DAILY_PRESSURE,
  dailyPressureThresholds,
} from "@/chain/dailyRules";
import {
  CAMPAIGN_CONTENT_VERSION,
  canonicalCampaignMap,
} from "@/chain/campaignCatalog";
import {
  projectRunFromLocalState,
  type ActiveRunRulesView,
  type ActiveRunView,
} from "@/chain/runPlan";
import {
  coreApplyRunBonus,
  coreApplyRunVrf,
  coreBuildRunConfig,
  corePlayRunMove,
  coreReconcileRunState,
  coreRequestRunReroll,
  coreRunSummary,
} from "@/core/zkubeCore";

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
    bossId: map.mapRules.bossId,
    guardian: map.mapRules.guardian,
    startingRows: map.mapRules.startingRows,
  };
}

/**
 * Exactly what `daily_level_rules` builds on chain from the drawn realm and
 * pressure profile: an unreachable points target (the Daily is not a level to
 * clear), the profile's move budget, difficulty zero, and the realm's guardian.
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
  bossId: 0,
  guardian: { bonus: BonusType.Hammer, trigger: 2, threshold: 4 },
  startingRows: canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, DEV_BOARD_MAP_ID)
    .mapRules.startingRows,
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
  const rulesHash = new Uint8Array(32).fill(0x33);
  const replayHash = new Uint8Array(32).fill(0x42);
  const config = coreBuildRunConfig({
    mode: isArena ? "daily" : "campaign",
    rulesHash,
    initialReplay: replayHash,
    maxMoves: rules.maxMoves,
    bonusType: rules.guardian.bonus,
    trigger: rules.guardian.trigger,
    triggerThreshold: rules.guardian.threshold,
    startingHeight: rules.startingRows,
    fixedTier: rules.difficulty,
    pointsRequired: rules.pointsRequired,
    primary: rules.primary,
    secondary: rules.secondary,
    objective: { kind: 4, value: 2, requiredCount: 0 },
  });
  const state = coreReconcileRunState(config, {
    phase: "playing",
    endReason: 0,
    bonusType: rules.guardian.bonus,
    bonusCharges: 2,
    rerollCharges: 1,
    comboCounter: 2,
    maxCombo: 5,
    primaryProgress: Math.min(3, rules.primary.requiredCount),
    secondaryProgress: Math.min(1, rules.secondary.requiredCount),
    latchedStarSources: 0,
    streak: 0,
    chargesEarned: 0,
    currentTier: isArena ? 4 : rules.difficulty,
    levelLinesCleared: 11,
    moves,
    actionCounter: moves + 1,
    vrfRequestCounter: 12,
    pendingVrfCounter: 0,
    score,
    dailyScore: isArena ? 24_180 : 0,
    objectiveTotal: isArena ? 480n : 0n,
    pressureScore: isArena ? 80 : 0,
    grid: encodeGrid(BOARD_ROWS_BOTTOM_UP),
    nextRow: NEXT_ROW,
    replayHash,
  });
  const base: ActiveRunView = {
    runToken: { config, state },
    owner,
    rentPayer: owner,
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
    dailyScore: 0,
    objectiveTotal: 0n,
    pressureScore: 0,
    dailyTheme: { kind: 4, value: 2 },
    dailyPressure: CANONICAL_DAILY_PRESSURE,
    actionCounter: 0,
    moves,
    comboCounter: 0,
    maxCombo: 0,
    primaryProgress: 0,
    secondaryProgress: 0,
    latchedStarSources: 0,
    streak: 0,
    chargesEarned: 0,
    levelLinesCleared: 0,
    totalLinesCleared: 0,
    bonusUses: 0,
    currentTier: 0,
    currentDifficulty: 0,
    // A run carries exactly one bonus type, and an id outside the enum falls
    // back to "None" — which renders an empty slot that reads as a wiring bug.
    bonusType: rules.guardian.bonus,
    bonusCharges: 0,
    rerollCharges: 1,
    grid: [],
    nextRow: null,
    pendingVrfCounter: 0,
    vrfRequestCounter: 0,
    pressureThresholds: dailyPressureThresholds(),
    pressureScoreMultipliersX100: CANONICAL_DAILY_PRESSURE.scoreMultipliersX100,
  };
  return projectRunFromLocalState(base, state);
}

export function playDevMove(
  run: ActiveRunView,
  row: number,
  start: number,
  destination: number,
): ActiveRunView {
  const token = requireToken(run);
  return hydrateDevRun(
    projectRunFromLocalState(
      run,
      corePlayRunMove({
        config: token.config,
        state: token.state,
        action: run.actionCounter,
        expectedMove: run.moves,
        row,
        start,
        destination,
      }),
    ),
  );
}

export function playDevBonus(
  run: ActiveRunView,
  row: number,
  column: number,
): ActiveRunView {
  const token = requireToken(run);
  return hydrateDevRun(
    projectRunFromLocalState(
      run,
      coreApplyRunBonus({
        config: token.config,
        state: token.state,
        action: run.actionCounter,
        row,
        column,
      }),
    ),
  );
}

export function playDevReroll(run: ActiveRunView): ActiveRunView {
  const token = requireToken(run);
  return hydrateDevRun(
    projectRunFromLocalState(
      run,
      coreRequestRunReroll(token.config, token.state, run.actionCounter),
    ),
  );
}

function hydrateDevRun(run: ActiveRunView): ActiveRunView {
  const token = requireToken(run);
  const summary = coreRunSummary(token.state);
  if (summary.phase !== "awaitingVrf") return run;
  const requestCounter = summary.lastVrfCounter + 1;
  return projectRunFromLocalState(
    run,
    coreApplyRunVrf({
      config: token.config,
      state: token.state,
      requestCounter,
      vrfOutput: new Uint8Array(32).fill(0x5a),
    }),
  );
}

function requireToken(run: ActiveRunView) {
  if (!run.runToken) throw new Error("Dev run has no core token");
  return run.runToken;
}
