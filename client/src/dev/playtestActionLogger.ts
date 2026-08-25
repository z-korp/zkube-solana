import type { ActiveRunView } from "@/chain/runPlan";
import { Game } from "@/game/model";

export const PLAYTEST_ACTION_EVENT = "zkube_playtest_action_v1";

export type PlaytestActionKind = "move" | "bonus" | "reroll";

interface ConstraintProgressRecord {
  kind: number;
  value: number;
  requiredCount: number;
  before: number;
  after: number;
}

export interface PlaytestActionRecord {
  schemaVersion: 1;
  event: typeof PLAYTEST_ACTION_EVENT;
  runId: string;
  mode: string;
  mapId: number;
  level: number;
  action: PlaytestActionKind;
  actionIndex: number;
  heightBefore: number;
  heightAfter: number;
  totalLinesBefore: number;
  totalLinesAfter: number;
  linesCleared: number;
  bonusAvailable: boolean;
  bonusUsed: boolean;
  rerollAvailable: boolean;
  rerollUsed: boolean;
  visiblePreviewRow: number[];
  constraints: {
    primary: ConstraintProgressRecord;
    secondary: ConstraintProgressRecord;
  };
}

export function buildPlaytestActionRecord(
  before: ActiveRunView,
  after: ActiveRunView,
  action: PlaytestActionKind,
): PlaytestActionRecord | null {
  if (after.actionCounter <= before.actionCounter) return null;

  const beforeGame = new Game(before);
  const afterGame = new Game(after);
  return {
    schemaVersion: 1,
    event: PLAYTEST_ACTION_EVENT,
    runId: after.runId.toString(),
    mode: after.mode,
    mapId: after.mapId,
    level: after.level,
    action,
    actionIndex: after.actionCounter,
    heightBefore: beforeGame.boardHeight,
    heightAfter: afterGame.boardHeight,
    totalLinesBefore: beforeGame.totalLinesCleared,
    totalLinesAfter: afterGame.totalLinesCleared,
    linesCleared: Math.max(
      0,
      afterGame.totalLinesCleared - beforeGame.totalLinesCleared,
    ),
    bonusAvailable: beforeGame.bonusType !== 0 && beforeGame.bonusCharges > 0,
    bonusUsed: action === "bonus",
    rerollAvailable: before.rerollAvailable,
    rerollUsed: action === "reroll",
    visiblePreviewRow: [...beforeGame.nextRow],
    constraints: {
      primary: {
        ...before.rules.primary,
        before: beforeGame.constraintProgress,
        after: afterGame.constraintProgress,
      },
      secondary: {
        ...before.rules.secondary,
        before: beforeGame.constraint2Progress,
        after: afterGame.constraint2Progress,
      },
    },
  };
}

export function logAcceptedPlaytestAction(
  before: ActiveRunView,
  after: ActiveRunView,
  action: PlaytestActionKind,
): void {
  if (!import.meta.env.DEV) return;
  const record = buildPlaytestActionRecord(before, after, action);
  if (record) console.info(JSON.stringify(record));
}
