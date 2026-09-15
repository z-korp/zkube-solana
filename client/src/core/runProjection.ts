import { campaignGuardianPresentation } from "./campaignCatalog.js";
import {
  CAMPAIGN_TARGET_LADDER,
  DAILY_MAX_MOVES,
} from "./protocolVersions.generated.js";
import {
  coreCampaignMoveBudget,
  coreRunSummary,
  type CoreRunMode,
  type CoreRunToken,
} from "./zkubeCore.js";

export interface ActiveRunConstraintView {
  kind: number;
  value: number;
  requiredCount: number;
}

interface RawConstraintSnapshot {
  kind: unknown;
  value: unknown;
  requiredCount: unknown;
}

interface RawGuardianSnapshot {
  bonus: unknown;
  trigger: unknown;
  threshold: unknown;
}

export interface RawLevelRuleSnapshot {
  pointsRequired?: unknown;
  difficulty: unknown;
  primary: RawConstraintSnapshot;
  secondary: RawConstraintSnapshot;
  activeMutatorId?: unknown;
  bossId?: unknown;
  guardian: RawGuardianSnapshot;
  startingRows: unknown;
}

export interface ActiveRunRulesView {
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: ActiveRunConstraintView;
  secondary: ActiveRunConstraintView;
  activeMutatorId: number;
  bossId: number;
  guardian: {
    bonus: number;
    trigger: number;
    threshold: number;
  };
  startingRows: number;
}

export function mapLevelRuleSnapshot(
  rules: RawLevelRuleSnapshot,
  mapId = 0,
  level = 0,
  mode: CoreRunMode = "campaign",
): ActiveRunRulesView {
  const presentation =
    mapId > 0
      ? campaignGuardianPresentation(mapId)
      : { activeMutatorId: 0, bossId: 0 };
  const difficulty = Number(rules.difficulty);
  const pointsRequired =
    mode === "campaign"
      ? CAMPAIGN_TARGET_LADDER[level - 1]
      : Number(rules.pointsRequired);
  if (pointsRequired === undefined) {
    throw new Error("Campaign level is outside the target ladder");
  }
  if (
    mode === "campaign" &&
    rules.pointsRequired !== undefined &&
    Number(rules.pointsRequired) !== pointsRequired
  ) {
    throw new Error("Campaign score target does not match the protocol ladder");
  }
  return {
    pointsRequired,
    maxMoves:
      mode === "campaign"
        ? coreCampaignMoveBudget(level, difficulty)
        : DAILY_MAX_MOVES,
    difficulty,
    primary: {
      kind: Number(rules.primary.kind),
      value: Number(rules.primary.value),
      requiredCount: Number(rules.primary.requiredCount),
    },
    secondary: {
      kind: Number(rules.secondary.kind),
      value: Number(rules.secondary.value),
      requiredCount: Number(rules.secondary.requiredCount),
    },
    activeMutatorId:
      rules.activeMutatorId === undefined
        ? presentation.activeMutatorId
        : Number(rules.activeMutatorId),
    bossId:
      rules.bossId === undefined
        ? level === 10
          ? presentation.bossId
          : 0
        : Number(rules.bossId),
    guardian: {
      bonus: Number(rules.guardian.bonus),
      trigger: Number(rules.guardian.trigger),
      threshold: Number(rules.guardian.threshold),
    },
    startingRows: Number(rules.startingRows),
  };
}

export function mapDailyRuleSnapshot(
  rules: { guardian: RawGuardianSnapshot; startingRows: unknown },
  mapId: number,
): ActiveRunRulesView {
  return mapLevelRuleSnapshot({
    ...rules, pointsRequired: 0, difficulty: 0,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
  }, mapId, 1, "daily");
}

export function projectCoreRun(token: CoreRunToken) {
  const summary = coreRunSummary(token.state);
  const pendingVrfCounter =
    summary.phase === "awaitingVrf" ? summary.lastVrfCounter + 1 : 0;
  return {
    runToken: token,
    lifecycle: summary.phase,
    finishReason:
      summary.endReason === 3
        ? "abandon"
        : summary.endReason === 4
          ? "deadline"
          : null,
    score: summary.score,
    dailyScore: summary.dailyScore,
    objectiveTotal: summary.objectiveTotal,
    pressureScore: summary.pressureScore,
    actionCounter: summary.actionCounter,
    moves: summary.moves,
    comboCounter: summary.comboCounter,
    maxCombo: summary.maxCombo,
    primaryProgress: summary.primaryProgress,
    secondaryProgress: summary.secondaryProgress,
    latchedStarSources: summary.latchedStarSources,
    streak: summary.streak,
    chargesEarned: summary.chargesEarned,
    levelLinesCleared: summary.levelLinesCleared,
    totalLinesCleared: summary.levelLinesCleared,
    bonusUses: 0,
    currentTier: summary.currentTier,
    currentDifficulty: summary.currentTier,
    bonusType: summary.bonusType,
    bonusCharges: summary.bonusCharges,
    rerollCharges: summary.rerollCharges,
    grid: summary.grid,
    nextRow: summary.nextRow,
    pendingVrfCounter,
    vrfRequestCounter: Math.max(summary.lastVrfCounter, pendingVrfCounter),
    rulesHash: summary.rulesHash,
    replayHash: summary.replayHash,
  };
}

/** Project an optimistic accepted action without reading account bytes. */
export function projectRunFromLocalState<T extends { runToken?: CoreRunToken }>(
  view: T,
  state: Uint8Array,
): T & ReturnType<typeof projectCoreRun> {
  if (!view.runToken) {
    throw new Error("Active run has no local core token");
  }
  return {
    ...view,
    ...projectCoreRun({ config: view.runToken.config, state }),
  };
}
