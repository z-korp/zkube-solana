import type { DailyStatus } from "@/chain/dailyClient";

/**
 * The presentational lifecycle states of the Guardian's Trial home. The
 * connect-gate is handled globally by App/ConnectScreen and is never computed
 * here.
 */
export type ArcadeLifecycle =
  | "resume"
  | "entries-open"
  | "entries-closed"
  | "preparing"
  | "delayed"
  | "stale";

interface DailyTiming {
  dayId: number;
  status: DailyStatus;
  opensAt: number;
  entriesCloseAt: number;
}

/**
 * Resolve which Trial surface to render from today's Daily view, the player's
 * live run, and the current time.
 *
 * Precedence:
 *  1. `resume` — a live ranked or legacy Practice run always wins.
 *  2. `stale` — only a previous Daily is visible.
 *  3. `preparing`/`delayed` — today's Daily is missing or not open, split by
 *     a short post-midnight keeper grace window.
 *  4. `entries-open` — today's Daily is open and inside the paid-entry window.
 *  5. `entries-closed` — today's Daily is guaranteed but the entry window has
 *     passed (settling, or already finalized) before the next UTC reset.
 */
export function computeArcadeLifecycle(args: {
  view: DailyTiming | null;
  hasActiveRun: boolean;
  nowUnix: number;
  expectedDayId?: number;
}): ArcadeLifecycle {
  const { view, hasActiveRun, nowUnix } = args;
  if (hasActiveRun) return "resume";
  const expectedDayId = args.expectedDayId ??
    Math.max(0, Math.floor(nowUnix / 86_400));
  if (view && view.dayId < expectedDayId) return "stale";
  if (!view || view.dayId !== expectedDayId ||
      view.status === "funding" || view.status === "unknown") {
    const delayedAt = expectedDayId * 86_400 + 15 * 60;
    return nowUnix >= delayedAt ? "delayed" : "preparing";
  }
  const entriesOpen =
    view.status === "open" &&
    view.opensAt <= nowUnix &&
    nowUnix < view.entriesCloseAt;
  return entriesOpen ? "entries-open" : "entries-closed";
}

/** Format a Unix-seconds instant as a bare UTC wall clock, e.g. "23:59 UTC". */
export function formatUtcClock(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}
