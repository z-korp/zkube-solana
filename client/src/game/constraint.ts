/** Wire-stable Campaign constraint kinds shared with zkube-core. */
export enum ConstraintType {
  None = 0,
  CombosOfAtLeast = 1,
  BreakBlocks = 2,
  ClearLines = 3,
  CombosOfExactly = 4,
  BigMoves = 5,
  TriggerFired = 6,
  BonusLines = 7,
  BonusBreaks = 8,
  ComboOfAtLeast = 9,
  ComboOfExactly = 10,
  Streak = 11,
  BreakInMove = 12,
  AllWidthsInMove = 13,
  BigMove = 14,
  BonusLinesInMove = 15,
  PerfectClear = 16,
  ClutchClears = 17,
  CleanClears = 18,
}

export type ConstraintClass = "cumulative" | "moment";

export function constraintClass(type: ConstraintType): ConstraintClass | null {
  if (type === ConstraintType.None) return null;
  return type <= ConstraintType.BonusBreaks ||
    type === ConstraintType.ClutchClears ||
    type === ConstraintType.CleanClears
    ? "cumulative"
    : "moment";
}

function count(
  value: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function width(value: number): string {
  return value === 0 ? "" : ` of width ${value}`;
}

export class Constraint {
  constructor(
    public constraintType: ConstraintType,
    public value: number,
    public requiredCount: number,
  ) {}

  static none(): Constraint {
    return new Constraint(ConstraintType.None, 0, 0);
  }

  static fromContractValues(
    type: number,
    value: number,
    requiredCount: number,
  ): Constraint {
    return new Constraint(type as ConstraintType, value, requiredCount);
  }

  isSatisfied(progress: number): boolean {
    return (
      this.constraintType !== ConstraintType.None &&
      progress >= this.requiredCount
    );
  }

  getDescription(triggerName = "the realm trigger"): string {
    const n = this.requiredCount;
    // Daily themes reuse the constraint kind and value without a completion
    // count. In that shape the sentence names the scoring fact rather than a
    // Campaign target.
    if (n === 0) {
      switch (this.constraintType) {
        case ConstraintType.None:
          return "No Theme today — the whole pot pays Score";
        case ConstraintType.CombosOfAtLeast:
          return `${this.value}+-line combo moves`;
        case ConstraintType.CombosOfExactly:
          return `exact ${this.value}-line clears`;
        case ConstraintType.BreakBlocks:
          return `width-${this.value} blocks broken`;
        case ConstraintType.TriggerFired:
          return `${triggerName} fired`;
        case ConstraintType.BonusLines:
          return "lines cleared with a bonus";
        case ConstraintType.BonusBreaks:
          return "blocks broken with a bonus";
        case ConstraintType.ClutchClears:
          return `clears started at height ${this.value}+`;
        case ConstraintType.CleanClears:
          return `clears ending at height ${this.value} or lower`;
        default:
          break;
      }
    }
    switch (this.constraintType) {
      case ConstraintType.None:
        return "No constraint";
      case ConstraintType.ClearLines:
        return `Clear ${count(n, "line")}`;
      case ConstraintType.BreakBlocks:
        return `Break ${count(n, "block")}${width(this.value)}`;
      case ConstraintType.CombosOfAtLeast:
        return `Make ${count(n, `${this.value}-line combo`)}`;
      case ConstraintType.CombosOfExactly:
        return `Make ${count(n, `exact ${this.value}-line combo`)}`;
      case ConstraintType.BigMoves:
        return `Make ${n} ${n === 1 ? "move" : "moves"} worth ${this.value}+ points`;
      case ConstraintType.TriggerFired:
        return `Fire ${triggerName} ${count(n, "time")}`;
      case ConstraintType.BonusLines:
        return `Clear ${count(n, "bonus line")}`;
      case ConstraintType.BonusBreaks:
        return `Smash ${count(n, "block")} with bonuses`;
      case ConstraintType.ComboOfAtLeast:
        return `Clear ${this.value} lines at once`;
      case ConstraintType.ComboOfExactly:
        return `Clear exactly ${this.value} lines at once`;
      case ConstraintType.Streak:
        return this.value === 1
          ? `Clear a line ${count(n, "move")} in a row`
          : `Make ${count(n, `${this.value}-line combo`)} in a row`;
      case ConstraintType.BreakInMove:
        return `Break ${count(n, "block")}${width(this.value)} at once`;
      case ConstraintType.AllWidthsInMove:
        return "Break every width at once";
      case ConstraintType.BigMove:
        return `Make a ${this.value}-point move`;
      case ConstraintType.BonusLinesInMove:
        return `Clear ${count(this.value, "line")} with one bonus`;
      case ConstraintType.PerfectClear:
        return "Empty the board";
      case ConstraintType.ClutchClears:
        return `Make ${count(n, "clear")} from height ${this.value}+`;
      case ConstraintType.CleanClears:
        return `Make ${count(n, "clear")} ending at height ${this.value} or lower`;
      default:
        return "Unknown constraint";
    }
  }

  getLabel(): string {
    return this.getDescription();
  }
}

export function dailyThemeDescription(
  theme: { kind: number; value: number } | null | undefined,
  triggerName?: string,
): string {
  if (!theme) return "Today's Theme is loading";
  return Constraint.fromContractValues(
    theme.kind,
    theme.value,
    0,
  ).getDescription(triggerName);
}
