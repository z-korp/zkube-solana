// Presentation view-model over the decoded on-chain ActiveRun account.
//
// Semantics (one on-chain run == one level of the campaign):
// - `over` is true only for a failed/ended run (`finished`); a completed
//   level (`levelComplete`) flows through the level-completion path.
// - `zoneCleared` marks a completed guardian trial (level 10 of a map).
// - scores are per-run: levelScore === totalScore === score.
import type { ActiveRunView } from "@/chain/runPlan";
import { isBossLevel } from "@/game/constants";

const ROWS = 10;
const COLS = 8;

/** Project the core's bottom-up cells into the display's top-down rows. */
export function toDisplayGrid(cells: readonly number[]): number[][] {
  const rows = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let index = 0; index < Math.min(cells.length, ROWS * COLS); index += 1) {
    const row = Math.floor(index / COLS);
    rows[ROWS - 1 - row]![index % COLS] = cells[index];
  }
  return rows;
}

export class Game {
  public id: bigint;
  public blocks: number[][];
  public nextRow: number[];
  public combo: number;
  public maxCombo: number;
  public over: boolean;

  private readonly view: ActiveRunView;
  private readonly levelStars: readonly number[];

  constructor(view: ActiveRunView, levelStars: readonly number[] = []) {
    this.view = view;
    this.levelStars = levelStars;
    this.id = view.runId;
    this.blocks = toDisplayGrid(view.grid);
    this.nextRow = view.nextRow ?? [];
    this.combo = view.comboCounter;
    this.maxCombo = view.maxCombo;
    this.over = view.lifecycle === "finished";
  }

  public get lifecycle(): string {
    return this.view.lifecycle;
  }

  public get level(): number {
    return this.view.level;
  }

  public get levelScore(): number {
    return this.mode === 1
      ? (this.view.dailyScore ?? this.view.score)
      : this.view.score;
  }

  public get levelMoves(): number {
    return this.view.moves;
  }

  /** Occupied board rows, measured from the floor. */
  public get boardHeight(): number {
    const firstOccupiedRow = this.blocks.findIndex((row) =>
      row.some((cell) => cell !== 0),
    );
    return firstOccupiedRow < 0 ? 0 : this.blocks.length - firstOccupiedRow;
  }

  /** Cells that a Totem targeting this block width would remove. */
  public countCellsOfSize(size: number): number {
    if (size < 1 || size > 4) return 0;
    return this.blocks.flat().filter((cell) => cell === size).length;
  }

  public get constraintProgress(): number {
    return this.view.primaryProgress;
  }

  public get constraint2Progress(): number {
    return this.view.secondaryProgress;
  }

  public get latchedStarSources(): number {
    return this.view.latchedStarSources;
  }

  public get maxComboRun(): number {
    return this.view.maxCombo;
  }

  public get totalScore(): number {
    return this.mode === 1
      ? (this.view.dailyScore ?? this.view.score)
      : this.view.score;
  }

  public get engineScore(): number {
    return this.view.score;
  }

  public get dailyScore(): number {
    return this.view.dailyScore ?? this.view.score;
  }

  public get challengeBonus(): number {
    return Number(this.view.objectiveTotal);
  }

  public get pressureScore(): number {
    return this.view.pressureScore ?? this.view.score;
  }

  public get totalLinesCleared(): number {
    return this.view.totalLinesCleared;
  }

  public get zoneId(): number {
    return this.view.mapId;
  }

  public get currentDifficulty(): number {
    return this.view.currentDifficulty;
  }

  public get pressureDepth(): number {
    return this.view.currentDifficulty;
  }

  public get pressureThresholds(): readonly number[] {
    return this.view.pressureThresholds;
  }

  public get pressureScoreMultipliersX100(): readonly number[] {
    return this.view.pressureScoreMultipliersX100;
  }

  public get levelCompleted(): boolean {
    return this.view.lifecycle === "levelComplete";
  }

  public get zoneCleared(): boolean {
    return this.levelCompleted && isBossLevel(this.view.level);
  }

  public get activeMutatorId(): number {
    return this.view.rules.activeMutatorId;
  }

  public get bonusType(): number {
    return this.view.bonusType;
  }

  public get bonusCharges(): number {
    return this.view.bonusCharges;
  }

  /** 0 = Campaign, 1 = Daily Arena. */
  public get mode(): number {
    return this.view.mode === "daily" ? 1 : 0;
  }

  public get runMode(): string {
    return this.view.mode;
  }

  public get score(): number {
    return this.totalScore;
  }

  public get moves(): number {
    return this.view.moves;
  }

  public isOver(): boolean {
    return this.over;
  }

  public getLevelStars(level: number): number {
    return this.levelStars[level - 1] ?? 0;
  }
}
