import { Swords } from "lucide-react";
import { motion } from "motion/react";

import { type ZoneGuardian } from "@/config/bossCharacters";
import { GUARDIAN_BUST_FADE_STYLE } from "@/config/guardianBlocks";
import { getMutatorDef } from "@/config/mutatorConfig";
import type { ThemeColors } from "@/config/themes";
import GuardianQuote from "@/ui/components/shared/GuardianQuote";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";

interface GuardianGreetingProps {
  colors: ThemeColors;
  guardian: ZoneGuardian;
  activeMutatorId?: number;
  passiveMutatorId?: number;
  isFirstVisit?: boolean;
  bossCleared?: boolean;
  onClose: () => void;
}

const GuardianGreeting: React.FC<GuardianGreetingProps> = ({
  colors,
  guardian,
  activeMutatorId,
  passiveMutatorId,
  isFirstVisit = false,
  bossCleared = false,
  onClose,
}) => {
  // Ace-Attorney beat: talk frames flap while the greeting types, then the
  // guardian rests on its bowed greeting expression.
  const talk = useGuardianTalk(guardian.zoneId, guardian.greeting, {
    mood: "greeting",
  });
  const activeMutator =
    activeMutatorId && activeMutatorId > 0
      ? getMutatorDef(activeMutatorId)
      : null;
  const passiveMutator =
    passiveMutatorId && passiveMutatorId > 0
      ? getMutatorDef(passiveMutatorId)
      : null;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={talk.typing ? talk.skip : onClose}
    >
      {/* Full-height portrait — seamlessly fading into background */}
      <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
        <motion.div
          className="relative h-[70%] max-h-[420px]"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: 0.1,
            type: "spring",
            stiffness: 200,
            damping: 20,
          }}
        >
          <img
            src={talk.src}
            alt={guardian.name}
            className="h-full w-auto object-contain"
            style={GUARDIAN_BUST_FADE_STYLE}
            draggable={false}
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        </motion.div>
      </div>

      {/* Dialog panel — bottom, full width */}
      <motion.div
        className="shrink-0"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 25 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="mx-2 mb-3 rounded-2xl border-2 px-4 pb-4 pt-3"
          style={{
            background: `linear-gradient(180deg, ${colors.backgroundGradientStart ?? "#0a1628"}F5, ${colors.background ?? "#050a12"}FA)`,
            borderColor: `${colors.accent}35`,
            boxShadow: `0 -4px 32px rgba(0,0,0,0.5), inset 0 1px 0 ${colors.accent}15`,
          }}
        >
          {/* Name bar */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-black text-white">
                {guardian.name}
              </span>
              <span
                className="rounded-full px-2 py-0.5 font-sans text-[9px] font-bold uppercase"
                style={{
                  color: colors.accent,
                  background: `${colors.accent}18`,
                }}
              >
                {guardian.title}
              </span>
            </div>
          </div>

          <GuardianQuote
            talk={talk}
            quoted
            className="mt-1 min-h-[2.6em] font-sans text-[14px] italic text-white/60"
          />

          {/* The guardian's own scoring hint for its realm. */}
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-white/70">
            {guardian.zoneHint}
          </p>

          {/* Mutators — the guardian explains each rule in prose; stat lines
              live in the in-game tooltips, not here. */}
          {(activeMutator || passiveMutator) && (
            <div className="mt-2 flex flex-col gap-1.5">
              {[activeMutator, passiveMutator].map((mutator) =>
                mutator ? (
                  <p
                    key={mutator.id}
                    className="font-sans text-[14px] leading-relaxed text-white"
                  >
                    {mutator.icon}{" "}
                    <span
                      className="font-semibold"
                      style={{ color: colors.accent }}
                    >
                      {mutator.name}
                    </span>{" "}
                    {mutator.description}
                  </p>
                ) : null,
              )}
            </div>
          )}

          {bossCleared && (
            <p className="mt-2 flex items-center gap-1.5 font-sans text-[12px] text-white/70">
              <Swords className="h-3.5 w-3.5" />
              This guardian trial has been mastered.
            </p>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="mt-3 w-full rounded-xl py-2.5 font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-white transition-colors"
            style={{
              background: `${colors.accent}30`,
              border: `1px solid ${colors.accent}50`,
            }}
          >
            {isFirstVisit ? "Begin" : "Close"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GuardianGreeting;
