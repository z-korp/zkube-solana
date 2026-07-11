import type { ActiveRunConstraintView } from "@/solana/reboot/runPlan";

export function constraintDescription(rule: ActiveRunConstraintView): string {
  if (rule.kind === 1)
    return `Clear ${rule.value}+ lines in one move ${rule.requiredCount} times`;
  if (rule.kind === 2)
    return `Break ${rule.requiredCount} blocks of size ${rule.value}`;
  if (rule.kind === 3) return `Reach a ${rule.value}× combo`;
  return "No constraint";
}

export function estimateStars(
  maxMoves: number,
  movesUsed: number,
  modifier: number,
): number {
  const positive = modifier >= 128;
  const magnitude = positive ? modifier - 128 : 128 - modifier;
  const change = magnitude * 5;
  const threePercent = positive
    ? Math.max(10, 50 - change)
    : Math.min(90, 50 + change);
  const twoPercent = positive
    ? Math.max(threePercent + 1, 75 - change)
    : Math.min(99, 75 + change);
  if (movesUsed <= Math.floor((maxMoves * threePercent) / 100)) return 3;
  if (movesUsed <= Math.floor((maxMoves * twoPercent) / 100)) return 2;
  return 1;
}
