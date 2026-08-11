/**
 * How a campaign constraint presents itself: an icon in a ring, the target on
 * one corner and the progress on the other. Shared so the ring is identical
 * wherever a constraint appears.
 */
import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import { ConstraintType } from "@/game/constraint";

export function constraintIcon(type: ConstraintType) {
  const src = CONSTRAINT_ICON_MAP[type];
  if (!src) return null;
  return (
    <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
  );
}

export function constraintColour(
  progress: number,
  count: number,
): "green" | "orange" | "red" | "blue" {
  if (progress >= count) return "green";
  if (progress > 0) return "orange";
  return "blue";
}

export function constraintProgressOf(progress: number, count: number): number {
  return count > 0 ? progress / count : 0;
}

/** The ask itself — "3+" combo lines, "4" blocks — not the progress. */
export function valueBadge(
  type: ConstraintType,
  value: number,
): string | undefined {
  switch (type) {
    case ConstraintType.ComboLines:
      return `${value}+`;
    case ConstraintType.BreakBlocks:
    case ConstraintType.ComboMeter:
      return `${value}`;
    default:
      return undefined;
  }
}

export function progressBadge(progress: number, count: number): string {
  return `${progress}/${count}`;
}
