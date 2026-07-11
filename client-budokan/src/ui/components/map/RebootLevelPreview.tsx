import { motion } from "motion/react";
import { Star, X } from "lucide-react";
import {
  getGuardianPortrait,
  getZoneGuardian,
} from "@/config/bossCharacters";
import { MUTATOR_DEFS } from "@/config/mutatorConfig";
import type { ThemeColors } from "@/config/themes";
import type { ActiveRunRulesView } from "@/solana/reboot/runPlan";
import { constraintDescription } from "@/ui/components/hud/runDisplay";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

const DIFFICULTY_LABELS = [
  "Very Easy",
  "Easy",
  "Medium",
  "Medium Hard",
  "Hard",
  "Very Hard",
  "Expert",
  "Master",
];

const DIFFICULTY_STYLES = [
  "text-emerald-300",
  "text-emerald-400",
  "text-yellow-300",
  "text-orange-300",
  "text-orange-400",
  "text-red-400",
  "text-rose-400",
  "text-red-500",
];

export interface RebootLevelPreviewProps {
  zoneId: number;
  level: number;
  rules: ActiveRunRulesView | null;
  stars: number;
  isBoss: boolean;
  cleared: boolean;
  colors: ThemeColors;
  onPlay: () => void;
  onClose: () => void;
}

export default function RebootLevelPreview({
  zoneId,
  level,
  rules,
  stars,
  isBoss,
  cleared,
  colors,
  onPlay,
  onClose,
}: RebootLevelPreviewProps) {
  const guardian = getZoneGuardian(zoneId);
  const constraints = rules
    ? [rules.primary, rules.secondary].filter((rule) => rule.kind !== 0)
    : [];
  const activeMutator =
    rules && rules.activeMutatorId > 0
      ? MUTATOR_DEFS[rules.activeMutatorId]
      : null;
  const passiveMutator =
    rules && rules.passiveMutatorId > 0
      ? MUTATOR_DEFS[rules.passiveMutatorId]
      : null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-[420px] rounded-t-3xl border p-5 text-white backdrop-blur-xl sm:rounded-3xl"
        style={{
          background: `linear-gradient(180deg, ${colors.background}F2, #050a12FA)`,
          borderColor: `${colors.accent}40`,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/40 p-1.5 text-white/70"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <img
            src={getGuardianPortrait(zoneId)}
            alt={guardian.name}
            className="h-14 w-14 rounded-full border-2 object-cover"
            style={{ borderColor: colors.accent }}
          />
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.25em]"
              style={{ color: colors.accent }}
            >
              {isBoss ? "Guardian trial" : `Level ${level}`}
            </p>
            <h2 className="font-display text-2xl font-black">
              {isBoss ? guardian.name : `Zone ${zoneId} · Level ${level}`}
            </h2>
            {rules && (
              <p
                className={`text-xs font-bold ${DIFFICULTY_STYLES[rules.difficulty] ?? "text-white/60"}`}
              >
                {DIFFICULTY_LABELS[rules.difficulty] ?? `Tier ${rules.difficulty}`}
              </p>
            )}
          </div>
        </div>

        <div className="my-3 flex gap-1 text-yellow-300">
          {Array.from({ length: 3 }, (_, index) => (
            <Star
              key={index}
              size={20}
              fill={index < stars ? "currentColor" : "none"}
            />
          ))}
        </div>

        {rules && (
          <div className="mb-3 grid grid-cols-2 gap-2 text-center text-sm">
            <div className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2">
              <strong className="block text-lg text-cyan-200">
                {rules.pointsRequired.toLocaleString()}
              </strong>
              <span className="text-[9px] uppercase tracking-widest text-white/40">
                Target score
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2">
              <strong className="block text-lg text-cyan-200">
                {rules.maxMoves}
              </strong>
              <span className="text-[9px] uppercase tracking-widest text-white/40">
                Max moves
              </span>
            </div>
          </div>
        )}

        {constraints.length > 0 && (
          <div className="mb-3 space-y-1">
            {constraints.map((rule, index) => (
              <p
                key={index}
                className="rounded-lg border border-cyan-300/20 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-100"
              >
                {constraintDescription(rule)}
              </p>
            ))}
          </div>
        )}

        {(activeMutator || passiveMutator) && (
          <div className="mb-3 space-y-1">
            {[activeMutator, passiveMutator]
              .filter((mutator) => mutator !== null)
              .map((mutator) => (
                <p
                  key={mutator.id}
                  className="rounded-lg border border-purple-300/20 bg-purple-950/40 px-3 py-1.5 text-xs text-purple-100"
                >
                  {mutator.icon} <strong>{mutator.name}</strong> ·{" "}
                  {mutator.description}
                </p>
              ))}
          </div>
        )}

        <ArcadeButton onClick={onPlay}>
          {isBoss
            ? `Face ${guardian.name}`
            : cleared
              ? `Replay level ${level}`
              : `Play level ${level}`}
        </ArcadeButton>
      </motion.div>
    </div>
  );
}
