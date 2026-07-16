// Presentation view-model over the decoded on-chain ActiveRun account.
//
// Semantics (one on-chain run == one level of the campaign):
// - `over` is true only for a failed/ended run (`finished`); a completed
//   level (`levelComplete`) flows through the level-completion path.
// - `zoneCleared` marks a completed guardian trial (level 10 of a map).
// - scores are per-run: levelScore === totalScore === score.
import { toDisplayGrid } from "@/chain/gridProjection";
import type { ActiveRunView } from "@/chain/runPlan";
import { isBossLevel } from "@/game/constants";

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

  public get constraintProgress(): number {
    return this.view.primaryProgress;
  }

  public get constraint2Progress(): number {
    return this.view.secondaryProgress;
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
    return Math.max(0, this.dailyScore - this.engineScore);
  }

  public get pressureScore(): number {
    return this.view.pressureScore ?? this.view.score;
  }

  public get totalCubes(): number {
    return this.view.totalLinesCleared;
  }

  public get zoneId(): number {
    return this.view.mapId;
  }

  public get currentDifficulty(): number {
    return this.view.currentDifficulty;
  }

  public get endlessDepth(): number {
    return this.view.currentDifficulty;
  }

  public get endlessThresholds(): readonly number[] {
    return this.view.endlessThresholds;
  }

  public get endlessScoreMultipliersX100(): readonly number[] {
    return this.view.endlessScoreMultipliersX100;
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

  public get bonusTriggerType(): number {
    return this.view.rules.bonusTriggerType;
  }

  /** 0 = story/campaign, 1 = endless (Daily Arena). */
  public get mode(): number {
    return this.view.mode === "daily" ? 1 : 0;
  }

  /** On Solana a level boundary is a run boundary — never mid-game. */
  public get levelTransitionPending(): boolean {
    return false;
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
