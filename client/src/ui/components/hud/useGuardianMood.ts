/**
 * What the guardian's face is doing, and why.
 *
 * The realm ships ten expression frames per zone and until now they were only
 * ever used in map dialogue. In a run he is the reaction shot: the cheapest
 * feedback in games, and the only thing on this screen that can look back.
 *
 * Two rules hold the whole thing together:
 *
 * - PRIORITY, NOT RECENCY. Two events can land in the same frame — a combo
 *   that also breaches row 1 — so the moods are ordered and the higher one
 *   wins outright rather than the later one overwriting it.
 * - HE ONLY REACTS TO WHAT HAPPENED. Never anticipation, never a timer, with
 *   the single exception of the blink. A face that moves while the player is
 *   planning is a liability, and he sits directly above the stack.
 */
import { useEffect, useRef, useState } from "react";

export type GuardianMood =
  | "idle"
  | "blink"
  | "greeting"
  | "satisfied"
  | "surprised"
  | "celebrate"
  | "defeated";

/** Highest first. `danger` and `defeated` are held, the rest are timed. */
const HOLD_MS: Partial<Record<GuardianMood, number>> = {
  greeting: 1_000,
  satisfied: 1_200,
  celebrate: 1_800,
};

const BLINK_EVERY_MS = 6_000;
const BLINK_MS = 120;

export interface GuardianSignals {
  /** New run: he greets once. */
  runId?: bigint | number;
  /** Current chain. Three or more is worth a face. */
  combo: number;
  /** The stack has reached the row that ends the run. */
  danger: boolean;
  /** Bumped once per perfect clear. */
  perfectSignal: number;
  /** The run is over — true for lost, "won" for cleared. */
  ended: false | "won" | "lost";
}

const SATISFIED_FROM = 3;

export function useGuardianMood({
  runId,
  combo,
  danger,
  perfectSignal,
  ended,
}: GuardianSignals): GuardianMood {
  // A timed mood and its deadline. Danger and defeat are not timed: they are
  // conditions, and they end when the condition does.
  const [timed, setTimed] = useState<{ mood: GuardianMood; until: number } | null>(
    null,
  );
  const [blinking, setBlinking] = useState(false);

  const raise = (mood: GuardianMood) => {
    const hold = HOLD_MS[mood] ?? 1_000;
    setTimed((current) => {
      const now = Date.now();
      // Never let a mood retrigger inside its own hold, or a long chain
      // becomes a stutter.
      if (current && current.mood === mood && current.until > now) return current;
      return { mood, until: now + hold };
    });
  };

  const runRef = useRef(runId);
  useEffect(() => {
    if (runId === undefined || runId === runRef.current) return;
    runRef.current = runId;
    raise("greeting");
  }, [runId]);

  const perfectRef = useRef(perfectSignal);
  useEffect(() => {
    if (perfectSignal === perfectRef.current) return;
    perfectRef.current = perfectSignal;
    if (perfectSignal > 0) raise("celebrate");
  }, [perfectSignal]);

  useEffect(() => {
    if (combo >= SATISFIED_FROM) raise("satisfied");
  }, [combo]);

  // Expire the timed mood on its own schedule rather than on render, so a
  // still board still lets him settle back to idle.
  useEffect(() => {
    if (!timed) return;
    const remaining = timed.until - Date.now();
    if (remaining <= 0) {
      setTimed(null);
      return;
    }
    const timer = window.setTimeout(() => setTimed(null), remaining);
    return () => window.clearTimeout(timer);
  }, [timed]);

  useEffect(() => {
    if (ended !== false || danger) return;
    const interval = window.setInterval(() => {
      setBlinking(true);
      window.setTimeout(() => setBlinking(false), BLINK_MS);
    }, BLINK_EVERY_MS);
    return () => window.clearInterval(interval);
  }, [danger, ended]);

  if (ended === "lost") return "defeated";
  if (ended === "won") return "celebrate";
  if (timed?.mood === "celebrate") return "celebrate";
  if (danger) return "surprised";
  if (timed) return timed.mood;
  return blinking ? "blink" : "idle";
}

export function guardianFrame(zoneId: number, mood: GuardianMood): string {
  const clamped = Math.min(10, Math.max(1, zoneId || 1));
  return `/assets/theme-${clamped}/boss/${mood}.png`;
}
