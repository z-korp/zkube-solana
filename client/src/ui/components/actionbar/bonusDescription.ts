export function buildTriggerDescription(
  triggerType: number,
  triggerThreshold: number,
): string {
  if (triggerType === 0) return "";

  const parts: string[] = [];
  if (triggerType === 1) {
    parts.push(`Clear ${triggerThreshold}+ lines in a move`);
  } else if (triggerType === 2) {
    parts.push(`Every ${triggerThreshold} lines cleared by moves`);
  } else if (triggerType === 4) {
    parts.push(`Clear exactly ${triggerThreshold} lines in a move`);
  } else if (triggerType === 6) {
    parts.push("Break every size in one move");
  } else if (triggerType === 7) {
    parts.push(`Every ${triggerThreshold} combos`);
  } else if (triggerType === 8) {
    parts.push(`Break ${triggerThreshold}+ blocks in one move`);
  } else if (triggerType === 9) {
    parts.push(`Clear a line ${triggerThreshold} moves in a row`);
  }
  return parts.join(" · ");
}

export interface TriggerFactState {
  triggerType: number;
  triggerThreshold: number;
  levelLinesCleared: number;
  comboCounter: number;
  streak: number;
}

/** Progress the engine can truthfully expose between actions. */
export function triggerFactProgress(state: TriggerFactState): {
  current: number;
  threshold: number;
  suffix?: string;
} | null {
  const threshold = state.triggerThreshold;
  if (state.triggerType === 2 && threshold > 0) {
    return { current: state.levelLinesCleared % threshold, threshold };
  }
  if (state.triggerType === 7 && threshold > 0) {
    return { current: state.comboCounter % threshold, threshold };
  }
  if (state.triggerType === 9 && threshold > 0) {
    return { current: state.streak % threshold, threshold };
  }
  if ([1, 4, 8].includes(state.triggerType) && threshold > 0) {
    return { current: 0, threshold, suffix: "this move" };
  }
  if (state.triggerType === 6) {
    return { current: 0, threshold: 1, suffix: "this move" };
  }
  return null;
}
