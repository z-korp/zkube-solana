export function buildTriggerDescription(
  triggerType: number,
  triggerThreshold: number,
  startingCharges: number,
): string {
  if (triggerType === 0) return "";

  const parts: string[] = [];
  if (triggerType === 1) {
    parts.push(`Clear ${triggerThreshold}+ lines in a move`);
  } else if (triggerType === 2) {
    parts.push(`Every ${triggerThreshold} lines cleared by moves`);
  } else if (triggerType === 3) {
    parts.push(
      `Charge when a move carries your score past each ${triggerThreshold} points`,
    );
  } else if (triggerType === 4) {
    parts.push(`Clear exactly ${triggerThreshold} lines in a move`);
  } else if (triggerType === 5) {
    parts.push("Perfect clear · max 1 charge between moves");
  } else if (triggerType === 6) {
    parts.push("Destroy block sizes 1–4 in one move");
  } else if (triggerType === 7) {
    parts.push(`Every ${triggerThreshold} Combo Meter points · max 1 per action`);
  }
  if (startingCharges > 0) {
    parts.push(`Start with ${startingCharges}`);
  }
  return parts.join(" · ");
}
