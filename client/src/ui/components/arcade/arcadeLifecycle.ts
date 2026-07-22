import type { DailyStatus } from "@/chain/dailyClient";

/**
 * The five presentational lifecycle states of the Guardian's Trial home. The
 * connect-gate is handled globally by App/ConnectScreen and is never computed
 * here, so this returns one of four surfaces for an already-connected player.
 */
export type ArcadeLifecycle =
  | "resume"
  | "entries-open"
  | "entries-closed"
  | "practice-only";

interface DailyTiming {
  status: DailyStatus;
  opensAt: number;
  entriesCloseAt: number;
}

/**
 * Resolve which Trial surface to render from today's Daily view, the player's
 * live run, and the current time.
 *
 * Precedence:
 *  1. `resume` — a live daily/practice run always wins; it must be finished or
 *     scored before anything else can start.
 *  2. `practice-only` — today's Daily is not a guaranteed, open pot yet
 *     (missing, still funding, or an unknown status). Only yesterday's free
 *     Practice is actionable.
 *  3. `entries-open` — today's Daily is open and inside the paid-entry window.
 *  4. `entries-closed` — today's Daily is guaranteed but the entry window has
 *     passed (settling, or already finalized) before the next UTC reset.
 */
export function computeArcadeLifecycle(args: {
  view: DailyTiming | null;
  hasActiveRun: boolean;
  nowUnix: number;
}): ArcadeLifecycle {
  const { view, hasActiveRun, nowUnix } = args;
  if (hasActiveRun) return "resume";
  if (!view || view.status === "funding" || view.status === "unknown") {
    return "practice-only";
  }
  const entriesOpen =
    view.status === "open" &&
    view.opensAt <= nowUnix &&
    nowUnix < view.entriesCloseAt;
  return entriesOpen ? "entries-open" : "entries-closed";
}

/** Format a Unix-seconds instant as a bare UTC wall clock, e.g. "23:30 UTC". */
export function formatUtcClock(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}
