/**
 * Constraint types for the level system
 * Constraints are level-specific objectives that must be met to complete a level
 */

export enum ConstraintType {
  /** No constraint - just reach the point goal */
  None = 0,
  /** Must clear X lines in a single move, Y times */
  ComboLines = 1,
  /** Must destroy X blocks of a specific size (accumulating) */
  BreakBlocks = 2,
  /** Must reach X on the cumulative Combo Meter (one-shot) */
  ComboMeter = 3,
}

export class Constraint {
  public constraintType: ConstraintType;
  public value: number;
  public requiredCount: number;

  constructor(constraintType: ConstraintType, value: number, requiredCount: number) {
    this.constraintType = constraintType;
    this.value = value;
    this.requiredCount = requiredCount;
  }

  static none(): Constraint {
    return new Constraint(ConstraintType.None, 0, 0);
  }

  static clearLines(lines: number, times: number): Constraint {
    return new Constraint(ConstraintType.ComboLines, lines, times);
  }

  static breakBlocks(targetSize: number, count: number): Constraint {
    return new Constraint(ConstraintType.BreakBlocks, targetSize, count);
  }

  static reachComboMeter(comboTarget: number): Constraint {
    return new Constraint(ConstraintType.ComboMeter, comboTarget, 1);
  }

  static fromContractValues(type: number, value: number, count: number): Constraint {
    return new Constraint(type as ConstraintType, value, count);
  }

  isSatisfied(progress: number): boolean {
    switch (this.constraintType) {
      case ConstraintType.None:
        return true;
      case ConstraintType.ComboLines:
        return progress >= this.requiredCount;
      case ConstraintType.BreakBlocks:
        return progress >= this.requiredCount;
      case ConstraintType.ComboMeter:
        return progress >= 1;
      default:
        return true;
    }
  }

  getDescription(): string {
    switch (this.constraintType) {
      case ConstraintType.None:
        return "No constraint";
      case ConstraintType.ComboLines:
        return `Make ${this.value}+ combos ${this.requiredCount} time${this.requiredCount > 1 ? "s" : ""}`;
      case ConstraintType.BreakBlocks:
        return `Break ${this.requiredCount} size-${this.value} blocks`;
      case ConstraintType.ComboMeter:
        return `Reach ${this.value} on the Combo Meter`;
      default:
        return "Unknown";
    }
  }

  getLabel(): string {
    switch (this.constraintType) {
      case ConstraintType.None:
        return "";
      case ConstraintType.ComboLines:
        return `${this.value}+ combos x${this.requiredCount}`;
      case ConstraintType.BreakBlocks:
        return `Break ${this.requiredCount}x size-${this.value}`;
      case ConstraintType.ComboMeter:
        return `Combo Meter ${this.value}`;
      default:
        return "";
    }
  }
}
