import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import {
  getGuardianFrame,
  hasGuardianFrames,
  type GuardianFrameId,
} from "@/config/guardianBlocks";

/**
 * The resting frame once the line has fully typed. `idle` also blinks;
 * every other mood holds its frame so the scene keeps its emotional beat.
 */
export type GuardianTalkMood =
  | "idle"
  | "greeting"
  | "satisfied"
  | "celebrate"
  | "defeated"
  | "surprised";

// Ace-Attorney pacing: a readable cadence with real holds on punctuation so
// the line breathes. Deliberately unhurried — skipping completes the line.
const TYPE_MS = 46;
const HOLD_SENTENCE_MS = 320;
const HOLD_COMMA_MS = 150;
const FLAP_MS = 130;

const PRELOAD_FRAMES: GuardianFrameId[] = [
  "idle",
  "talk-open",
  "talk-mid",
  "blink",
];

/**
 * Shared Ace-Attorney talk driver: typewriter text with talk-frame mouth
 * flaps while typing, then the mood frame (idle blinks) once the line lands.
 * Zones without a generated frame set fall back to the static portrait, so
 * every surface can adopt this for all ten guardians unconditionally.
 */
export function useGuardianTalk(
  zoneId: number,
  line: string,
  mood: GuardianTalkMood = "idle",
  onLineDone?: () => void,
) {
  const reduceMotion = useReducedMotion();
  const animated = hasGuardianFrames(zoneId) && !reduceMotion;

  const [typed, setTyped] = useState(reduceMotion ? line.length : 0);
  const [frame, setFrame] = useState<GuardianFrameId>("idle");
  const typing = typed < line.length;
  const doneFired = useRef(false);
  const skipRef = useRef(false);

  // Preload the flap set and the mood frame so swaps never flash.
  useEffect(() => {
    if (!hasGuardianFrames(zoneId)) return;
    for (const f of [...PRELOAD_FRAMES, mood]) {
      const img = new Image();
      img.src = getGuardianFrame(zoneId, f);
    }
  }, [zoneId, mood]);

  // Timeout-chained typewriter: the delay after each character depends on the
  // character, giving sentence and clause holds their weight.
  useEffect(() => {
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
  }, [line, reduceMotion]);

  useEffect(() => {
    if (typed >= line.length && !doneFired.current) {
      doneFired.current = true;
      onLineDone?.();
    }
  }, [typed, line, onLineDone]);

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

  const src = !hasGuardianFrames(zoneId)
    ? getGuardianFrame(zoneId, "idle")
    : reduceMotion
      ? getGuardianFrame(zoneId, mood)
      : getGuardianFrame(zoneId, frame);

  const skip = () => {
    skipRef.current = true;
    setTyped(line.length);
  };

  return { typed, typing, src, skip };
}
