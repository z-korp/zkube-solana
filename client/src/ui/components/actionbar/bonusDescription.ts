export function buildTriggerDescription(
  triggerType: number,
  triggerThreshold: number,
  startingCharges: number,
): string {
  if (triggerType === 0 || triggerThreshold === 0) return "";

  const parts: string[] = [];
  if (triggerType === 1) {
    parts.push(`Clear ${triggerThreshold}+ lines in a move`);
  } else if (triggerType === 2) {
    parts.push(`Every ${triggerThreshold} lines cleared`);
  } else if (triggerType === 3) {
    parts.push(`Every ${triggerThreshold} points scored`);
  }
  if (startingCharges > 0) {
    parts.push(`Start with ${startingCharges}`);
  }
  return parts.join(" · ");
}
