import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import {
  getGuardianFrame,
  type GuardianFrameId,
} from "@/config/guardianBlocks";

/**
 * The resting frame once the line has fully typed. `idle` also blinks;
 * every other mood holds its frame so the scene keeps its emotional beat.
 */
export type GuardianTalkMood = Exclude<
  GuardianFrameId,
  "blink" | "talk-mid" | "talk-open"
>;

interface GuardianTalkOptions {
  mood?: GuardianTalkMood;
  /** Fires once when the full line is on screen (typed or skipped). */
  onLineDone?: () => void;
  /** False parks the scene: no typing, no timers, no preloads (closed sheets). */
  enabled?: boolean;
  /** Wins over the talk machine outright (e.g. the coin-feed jaws). */
  overrideFrame?: GuardianFrameId;
}

// Ace-Attorney pacing: a readable cadence with real holds on punctuation so
// the line breathes. Deliberately unhurried — skipping completes the line.
const TYPE_MS = 46;
const HOLD_SENTENCE_MS = 320;
const HOLD_COMMA_MS = 150;
const FLAP_MS = 130;

const FLAP_FRAMES: GuardianFrameId[] = ["idle", "talk-open", "talk-mid"];

// Frames fetched once per session, shared across every surface and mount.
const preloaded = new Set<string>();
function preload(url: string) {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.src = url;
}

/**
 * Shared Ace-Attorney talk driver: typewriter text with talk-frame mouth
 * flaps while typing, then the mood frame (idle blinks) once the line lands.
 */
export function useGuardianTalk(
  zoneId: number,
  line: string,
  { mood = "idle", onLineDone, enabled = true, overrideFrame }: GuardianTalkOptions = {},
) {
  const reduceMotion = useReducedMotion();
  const animated = !reduceMotion && enabled;

  const [typed, setTyped] = useState(reduceMotion ? line.length : 0);
  const [frame, setFrame] = useState<GuardianFrameId>("idle");
  const typing = enabled && typed < line.length;
  const doneFired = useRef(false);
  const skipRef = useRef(false);

  // Preload the flap set (blink only where it can show) and the mood frame.
  useEffect(() => {
    if (!enabled) return;
    for (const f of FLAP_FRAMES) preload(getGuardianFrame(zoneId, f));
    if (mood === "idle") preload(getGuardianFrame(zoneId, "blink"));
  }, [zoneId, mood, enabled]);
  useEffect(() => {
    if (enabled) preload(getGuardianFrame(zoneId, mood));
  }, [zoneId, mood, enabled]);

  // Timeout-chained typewriter: the delay after each character depends on the
  // character, giving sentence and clause holds their weight.
  useEffect(() => {
    if (!enabled) {
      setTyped(0);
      return;
    }
    if (reduceMotion) {
      setTyped(line.length);
      return;
    }
    setTyped(0);
    skipRef.current = false;
    let timer = 0;
    let index = 0;
    const step = () => {
      if (skipRef.current) return;
      index += 1;
      setTyped(index);
      if (index >= line.length) return;
      const prev = line[index - 1];
      const hold =
        prev === "." || prev === "!" || prev === "?"
          ? HOLD_SENTENCE_MS
          : prev === ","
            ? HOLD_COMMA_MS
            : 0;
      timer = window.setTimeout(step, TYPE_MS + hold);
    };
    timer = window.setTimeout(step, TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [line, reduceMotion, enabled]);

  useEffect(() => {
    if (enabled && typed >= line.length && !doneFired.current) {
      doneFired.current = true;
      onLineDone?.();
    }
  }, [typed, line, onLineDone, enabled]);

  // Mouth flap while typing.
  useEffect(() => {
    if (!animated || !typing) return;
    let open = true;
    setFrame("talk-open");
    const timer = window.setInterval(() => {
      open = !open;
      setFrame(open ? "talk-open" : "talk-mid");
    }, FLAP_MS);
    return () => window.clearInterval(timer);
  }, [animated, typing]);

  // Rest on the mood after the line lands; only idle blinks.
  useEffect(() => {
    if (!animated || typing) return;
    setFrame(mood);
    if (mood !== "idle") return;
    let blinkBack: number | null = null;
    const timer = window.setInterval(() => {
      setFrame("blink");
      blinkBack = window.setTimeout(() => setFrame("idle"), 140);
    }, 3_400);
    return () => {
      window.clearInterval(timer);
      if (blinkBack !== null) window.clearTimeout(blinkBack);
    };
  }, [animated, typing, mood]);

  const src = getGuardianFrame(
    zoneId,
    overrideFrame ?? (animated ? frame : mood),
  );

  const skip = () => {
    skipRef.current = true;
    setTyped(line.length);
  };

  return { typed, typing, text: line.slice(0, typed), src, skip };
}
