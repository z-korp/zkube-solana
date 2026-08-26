import type { ActiveRunConstraintView } from "@/chain/runPlan";
import { Constraint } from "@/game/constraint";

export function constraintDescription(rule: ActiveRunConstraintView): string {
  return Constraint.fromContractValues(
    rule.kind,
    rule.value,
    rule.requiredCount,
  ).getDescription();
}
