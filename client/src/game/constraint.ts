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
}

export type ConstraintClass = "cumulative" | "moment";

export function constraintClass(type: ConstraintType): ConstraintClass | null {
  if (type === ConstraintType.None) return null;
  return type <= ConstraintType.BonusBreaks ? "cumulative" : "moment";
}

function count(value: number, singular: string, plural = `${singular}s`): string {
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

  static fromContractValues(type: number, value: number, requiredCount: number): Constraint {
    return new Constraint(type as ConstraintType, value, requiredCount);
  }

  isSatisfied(progress: number): boolean {
    return this.constraintType !== ConstraintType.None && progress >= this.requiredCount;
  }

  getDescription(): string {
    const n = this.requiredCount;
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
        return `Wake the guardian ${count(n, "time")}`;
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
      default:
        return "Unknown constraint";
    }
  }

  getLabel(): string {
    return this.getDescription();
  }
}
