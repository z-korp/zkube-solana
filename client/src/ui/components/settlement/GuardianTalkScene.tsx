import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { TalkCaret } from "@/ui/components/shared/GuardianQuote";
import {
  useGuardianTalk,
  type GuardianTalkMood,
} from "@/ui/components/shared/useGuardianTalk";

interface GuardianTalkSceneProps {
  zoneId: number;
  /** The line the guardian speaks, revealed letter by letter. */
  line: string;
  /** Scene card height in px. */
  height?: number;
  /** Fires once when the full line is on screen (typed or skipped). */
  onLineDone?: () => void;
  /** Resting frame once the line lands; `celebrate` also shakes and glows. */
  mood?: GuardianTalkMood;
}

/**
 * The Ace-Attorney guardian scene: a contained portrait card (never
 * full-screen) with the guardian's name tag and a typewriter dialogue box.
 * All typing, mouth-flap, blink, and mood-rest behaviour lives in
 * useGuardianTalk so full-screen surfaces can share it. Tapping the scene
 * completes the line immediately.
 */
const GuardianTalkScene: React.FC<GuardianTalkSceneProps> = ({
  zoneId,
  line,
  height = 236,
  onLineDone,
  mood = "idle",
}) => {
  const guardian = getZoneGuardian(zoneId);
  const talk = useGuardianTalk(zoneId, line, { mood, onLineDone });
  const celebrate = mood === "celebrate" && !talk.typing;

  return (
    <button
      type="button"
      onClick={talk.skip}
      aria-label={`${guardian.name} says: ${line}`}
      className="relative block w-full cursor-default overflow-hidden rounded-2xl border border-white/[0.14] text-left"
      style={{ height }}
    >
      <motion.img
        src={talk.src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "center 24%" }}
        animate={celebrate ? { x: [0, -5, 5, -3, 3, 0] } : undefined}
        transition={celebrate ? { duration: 0.4, ease: "easeOut" } : undefined}
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
          {talk.text}
          <TalkCaret talk={talk} />
        </span>
      </span>
    </button>
  );
};

export default GuardianTalkScene;
