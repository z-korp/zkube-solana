import { currentDailyDayId } from "@/chain/dailyClient";

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

/**
 * Coarse remaining time for labels that should not tick every second:
 * "2d 3h", "3h 12m", "12m", "<1m".
 */
export function formatDurationCoarse(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const minutes = Math.floor((sec % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

/** Unix time (seconds) when the next Daily day starts. */
export function nextDailyResetUnix(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return (currentDailyDayId(nowUnix) + 1) * 86_400;
}

/** Unix time (seconds) when Monday's weekly cadence resets. */
export function nextWeeklyResetUnix(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return (Math.floor((nowUnix + 259_200) / 604_800) + 1) * 604_800 - 259_200;
}
