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
