import type { ActiveRunConstraintView } from "@/chain/runPlan";

export function constraintDescription(rule: ActiveRunConstraintView): string {
  if (rule.kind === 1) {
    return `Clear ${rule.value}+ lines in one move ${rule.requiredCount} times`;
  }
  if (rule.kind === 2) {
    return `Break ${rule.requiredCount} blocks of size ${rule.value}`;
  }
  if (rule.kind === 3) return `Reach ${rule.value} on the Combo Meter`;
  return "No constraint";
}
