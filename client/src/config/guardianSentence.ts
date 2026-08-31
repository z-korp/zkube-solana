import { BonusType } from "@/core/bonusTypes";

export interface GuardianRule {
  readonly bonus: number;
  readonly trigger: number;
  readonly threshold: number;
}

export function guardianSentence(guardian: GuardianRule): string {
  const bonus = guardianBonusName(guardian.bonus);
  const threshold = guardian.threshold;
  switch (guardian.trigger) {
    case 1:
      return `Clear ${threshold} or more lines in one move to earn a ${bonus}.`;
    case 2:
      return `Every ${threshold} lines cleared by moves earns a ${bonus}.`;
    case 4:
      return `Clear exactly ${threshold} lines in one move to earn a ${bonus}.`;
    case 6:
      return `Break every block size in one move to earn a ${bonus}.`;
    case 7:
      return `Every ${threshold} combos earns a ${bonus}.`;
    case 8:
      return `Break ${threshold} or more blocks in one move to earn a ${bonus}.`;
    case 9:
      return `Clear lines on ${threshold} moves in a row to earn a ${bonus}.`;
    default:
      throw new Error(`Unknown guardian trigger ${guardian.trigger}`);
  }
}

export function guardianBonusName(bonus: number): "Hammer" | "Totem" | "Wave" {
  switch (bonus) {
    case BonusType.Hammer:
      return "Hammer";
    case BonusType.Totem:
      return "Totem";
    case BonusType.Wave:
      return "Wave";
    default:
      throw new Error(`Unknown guardian bonus ${bonus}`);
  }
}
