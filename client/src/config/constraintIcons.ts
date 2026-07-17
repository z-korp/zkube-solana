import { ConstraintType } from "@/game/constraint";
import { getCommonAssetPath } from "@/config/themes";

/** Constraint-type icons shared by the in-game HUD and the level preview. */
export const CONSTRAINT_ICON_MAP: Record<ConstraintType, string | null> = {
  [ConstraintType.ComboLines]: getCommonAssetPath(
    "constraints/constraint-clear-lines.png",
  ),
  [ConstraintType.BreakBlocks]: getCommonAssetPath(
    "constraints/constraint-break-blocks.png",
  ),
  [ConstraintType.ComboMeter]: getCommonAssetPath(
    "constraints/constraint-combo.png",
  ),
  [ConstraintType.None]: null,
};
