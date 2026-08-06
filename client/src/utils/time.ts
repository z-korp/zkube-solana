/**
 * Ticking countdown: "HH:MM:SS", or "Xd HHh" once at least a day remains.
 * Negative inputs clamp to zero.
 */
export function formatCountdown(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const minutes = Math.floor((sec % 3_600) / 60);
  const seconds = sec % 60;
  if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h`;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
