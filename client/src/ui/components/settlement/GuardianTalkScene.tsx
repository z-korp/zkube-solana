import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import {
  getGuardianFrame,
  hasGuardianFrames,
  type GuardianFrameId,
} from "@/config/guardianBlocks";

interface GuardianTalkSceneProps {
  zoneId: number;
  /** The line the guardian speaks, revealed letter by letter. */
  line: string;
  /** Scene card height in px. */
  height?: number;
  /** Fires once when the full line is on screen (typed or skipped). */
  onLineDone?: () => void;
  /** Switches the guardian to the celebrate frame (payment landing). */
  celebrate?: boolean;
}

// Ace-Attorney pacing: a readable cadence with real holds on punctuation so
// the line breathes. Deliberately unhurried — tapping the scene skips ahead.
const TYPE_MS = 46;
const HOLD_SENTENCE_MS = 320;
const HOLD_COMMA_MS = 150;
const FLAP_MS = 130;

const PRELOAD_FRAMES: GuardianFrameId[] = [
  "idle",
  "talk-open",
  "talk-mid",
  "blink",
  "celebrate",
  "satisfied",
];

/**
 * The Ace-Attorney guardian scene: a contained portrait card (never
 * full-screen) with the guardian's name tag and a typewriter dialogue box.
 * Zones with a generated frame set flap talk frames while the text types and
 * blink at rest; everything else shows the static portrait, so the scene is
 * safe for all ten guardians while the sprite pipeline catches up.
 * Tapping the scene completes the line immediately; a bouncing advance caret
 * marks the line as fully delivered.
 */
const GuardianTalkScene: React.FC<GuardianTalkSceneProps> = ({
  zoneId,
  line,
  height = 236,
  onLineDone,
  celebrate = false,
}) => {
  const reduceMotion = useReducedMotion();
  const guardian = getZoneGuardian(zoneId);
  const animated = hasGuardianFrames(zoneId) && !reduceMotion;

  const [typed, setTyped] = useState(reduceMotion ? line.length : 0);
  const [frame, setFrame] = useState<GuardianFrameId>("idle");
  const typing = typed < line.length;
  const doneFired = useRef(false);
  const skipRef = useRef(false);

  // Preload every frame once so flaps never flash a missing image.
  useEffect(() => {
    if (!hasGuardianFrames(zoneId)) return;
    for (const f of PRELOAD_FRAMES) {
      const img = new Image();
      img.src = getGuardianFrame(zoneId, f);
    }
  }, [zoneId]);

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
    if (!animated || !typing || celebrate) return;
    let open = true;
    setFrame("talk-open");
    const timer = window.setInterval(() => {
      open = !open;
      setFrame(open ? "talk-open" : "talk-mid");
    }, FLAP_MS);
    return () => window.clearInterval(timer);
  }, [animated, typing, celebrate]);

  // Idle blink after the line lands.
  useEffect(() => {
    if (!animated || typing || celebrate) return;
    setFrame("idle");
    let blinkBack: number | null = null;
    const timer = window.setInterval(() => {
      setFrame("blink");
      blinkBack = window.setTimeout(() => setFrame("idle"), 140);
    }, 3_400);
    return () => {
      window.clearInterval(timer);
      if (blinkBack !== null) window.clearTimeout(blinkBack);
    };
  }, [animated, typing, celebrate]);

  useEffect(() => {
    if (celebrate) setFrame("celebrate");
  }, [celebrate]);

  const src = useMemo(() => {
    if (!hasGuardianFrames(zoneId)) return getGuardianFrame(zoneId, "idle");
    if (reduceMotion) {
      return getGuardianFrame(zoneId, celebrate ? "celebrate" : "idle");
    }
    return getGuardianFrame(zoneId, frame);
  }, [zoneId, frame, celebrate, reduceMotion]);

  const skip = () => {
    skipRef.current = true;
    setTyped(line.length);
  };

  return (
    <button
      type="button"
      onClick={skip}
      aria-label={`${guardian.name} says: ${line}`}
      className="relative block w-full cursor-default overflow-hidden rounded-2xl border border-white/[0.14] text-left"
      style={{ height }}
    >
      <motion.img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "center 24%" }}
        animate={
          celebrate && !reduceMotion ? { x: [0, -5, 5, -3, 3, 0] } : undefined
        }
        transition={
          celebrate && !reduceMotion ? { duration: 0.4, ease: "easeOut" } : undefined
        }
      />
      {celebrate && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, rgba(250,204,21,0.28), transparent 65%)",
          }}
        />
      )}
      <span
        className="absolute left-3 top-[-1px] rounded-b-lg px-2.5 py-1 font-display text-sm tracking-[0.06em] text-[#3a2c04]"
        style={{
          background: "#FACC15",
          boxShadow: "0 2px 0 rgba(138,106,8,0.9)",
        }}
      >
        {guardian.name}
      </span>
      <span className="absolute inset-x-2 bottom-2 rounded-xl border border-white/[0.18] bg-[#0b0716]/85 px-3 py-2.5 backdrop-blur-sm">
        <span className="block pr-5 font-sans text-[15px] font-medium leading-snug text-white/95">
          {line.slice(0, typed)}
          {typing && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-2 animate-pulse bg-yellow-400 align-middle"
            />
          )}
        </span>
      </span>
    </button>
  );
};

export default GuardianTalkScene;
