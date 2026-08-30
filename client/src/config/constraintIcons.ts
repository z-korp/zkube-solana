import { ConstraintType } from "@/game/constraint";
import { getCommonAssetPath } from "@/config/themes";

/** Constraint-type icons shared by the in-game HUD and the level preview. */
export const CONSTRAINT_ICON_MAP: Record<ConstraintType, string | null> = {
  [ConstraintType.None]: null,
  [ConstraintType.ClearLines]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.CombosOfAtLeast]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.CombosOfExactly]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.BigMoves]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.TriggerFired]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.BonusLines]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.BonusBreaks]: getCommonAssetPath(
    "constraints/constraint-break-blocks.png",
  ),
  [ConstraintType.BreakBlocks]: getCommonAssetPath(
    "constraints/constraint-break-blocks.png",
  ),
  [ConstraintType.ComboOfAtLeast]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.ComboOfExactly]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.Streak]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.BreakInMove]: getCommonAssetPath(
    "constraints/constraint-break-blocks.png",
  ),
  [ConstraintType.AllWidthsInMove]: getCommonAssetPath(
    "constraints/constraint-break-blocks.png",
  ),
  [ConstraintType.BigMove]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.BonusLinesInMove]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.PerfectClear]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.ClutchClears]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.CleanClears]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
};
