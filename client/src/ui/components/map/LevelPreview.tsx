import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

import type { Game } from "@/game/model";
import { Constraint, ConstraintType } from "@/game/constraint";
import { getGuardianStarText, getZoneGuardian } from "@/config/bossCharacters";
import GuardianQuote from "@/ui/components/shared/GuardianQuote";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";
import type { ThemeColors } from "@/config/themes";
import type { GameLevelData } from "@/hooks/useGameLevel";
import type { MapNodeData } from "@/hooks/useMapData";
import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import { getGuardianDef } from "@/config/mutatorConfig";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import { PlaytestSeedControl } from "@/backend/local/PlaytestControls";
import { PLAYTEST_ACTIVE } from "@/buildTarget";

interface LevelPreviewProps {
  node: MapNodeData;
  game: Game | null;
  gameLevel: GameLevelData | null;
  zoneId: number;
  colors: ThemeColors;
  levelStars?: number[];
  /** True while the run is being created in place — the Play button shows
   * "Preparing…" and the preview cannot be dismissed mid-launch. */
  starting?: boolean;
  onPlay: () => void;
  onClose: () => void;
}

const DIFFICULTY_STYLES = [
  "text-emerald-300",
  "text-emerald-400",
  "text-yellow-300",
  "text-orange-300",
  "text-orange-400",
  "text-red-400",
  "text-rose-400",
  "text-red-500",
] as const;

const DIFFICULTY_LABELS = [
  "Very Easy",
  "Easy",
  "Medium",
  "Medium Hard",
  "Hard",
  "Very Hard",
  "Expert",
  "Master",
] as const;

function constraintDescriptions(
  level: GameLevelData | null,
  triggerName: string,
): Array<{ type: ConstraintType; icon: string | null; text: string }> {
  if (!level) return [];
  return [
    {
      type: level.constraintType,
      value: level.constraintValue,
      count: level.constraintCount,
    },
    {
      type: level.constraint2Type,
      value: level.constraint2Value,
      count: level.constraint2Count,
    },
  ]
    .filter(({ type }) => type !== ConstraintType.None)
    .map(({ type, value, count }) => ({
      type,
      icon: CONSTRAINT_ICON_MAP[type],
      text: Constraint.fromContractValues(type, value, count).getDescription(
        triggerName,
      ),
    }));
}

const LevelPreview: React.FC<LevelPreviewProps> = ({
  node,
  game,
  gameLevel,
  zoneId,
  colors,
  levelStars,
  starting = false,
  onPlay,
  onClose,
}) => {
  const guardian = getZoneGuardian(zoneId);
  const isBossLevel = node.type === "boss";
  const levelNum = node.contractLevel;

  const stars =
    levelStars?.[levelNum - 1] ?? game?.getLevelStars(levelNum) ?? 0;
  const isCleared = node.state === "cleared";

  // An active run is authoritative for itself; otherwise the map catalog's
  // exact rule snapshot is authoritative for the preview.
  const levelData =
    gameLevel?.level === levelNum ? gameLevel : node.levelConfig;
  const triggerName = getGuardianDef(zoneId).name;
  const constraints = constraintDescriptions(levelData, triggerName);
  const starRules = levelData
    ? [
        { icon: null, text: `Reach ${levelData.pointsRequired} Score` },
        ...constraints,
      ]
    : [];
  const canPlay =
    node.state === "current" ||
    node.state === "playing" ||
    node.state === "cleared";

  const guardianLine = isBossLevel
    ? isCleared
      ? guardian.respectLine
      : guardian.trialIntro
    : isCleared
      ? getGuardianStarText(guardian, stars)
      : guardian.encouragement;

  // Ace-Attorney beat: the guardian speaks the level's line, then rests —
  // celebrating a cleared trial, watchful on anything still to prove.
  const talk = useGuardianTalk(zoneId, guardianLine, {
    mood: isBossLevel && isCleared ? "celebrate" : "idle",
  });

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={starting ? undefined : onClose}
    >
      {/* Full-size guardian portrait */}
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
            draggable={false}
          />
        </motion.div>
      </div>

      {/* Dialog panel */}
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
            borderColor: isBossLevel
              ? "rgba(249,115,22,0.35)"
              : `${colors.accent}35`,
            boxShadow: isBossLevel
              ? "0 -4px 32px rgba(249,115,22,0.15)"
              : "0 -4px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Title + difficulty */}
          <div className="flex items-center justify-between">
            <p
              className={`font-display text-xl font-black ${isBossLevel ? "text-orange-300" : "text-white"}`}
            >
              {isBossLevel
                ? `Trial of ${guardian.name}`
                : `Level ${node.contractLevel}`}
            </p>
            {levelData && (
              <span
                className={`font-sans text-base font-bold ${DIFFICULTY_STYLES[levelData.difficulty] ?? "text-white"}`}
              >
                {DIFFICULTY_LABELS[levelData.difficulty] ??
                  `Tier ${levelData.difficulty}`}
              </span>
            )}
          </div>

          <GuardianQuote
            talk={talk}
            quoted
            className="mt-1 min-h-[2.6em] font-sans text-[14px] italic text-white/60"
          />

          {/* Cleared badge */}
          {isCleared && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2">
              <span className="font-sans text-sm font-bold text-emerald-300">
                Cleared
              </span>
              <span className="text-lg tracking-wider">
                {Array.from({ length: 3 }).map((_, index) => (
                  <span
                    key={index}
                    className={
                      index < stars ? "text-yellow-300" : "text-white/20"
                    }
                  >
                    ★
                  </span>
                ))}
              </span>
            </div>
          )}

          {/* Stats */}
          {levelData && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
                  <p className="font-sans text-lg font-bold text-white">
                    {levelData.maxMoves}
                  </p>
                  <p className="font-sans text-[10px] text-white/40">Moves</p>
                </div>
              </div>

              {/* Constraints — objectives to clear, side by side with their
                  in-game icons so they read as goals, not flavor. */}
              {starRules.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-sans text-[10px] font-semibold text-white/45">
                    Star rules latch in any order
                  </p>
                  {starRules.map((constraint, index) => (
                    <div
                      key={`${index}:${constraint.text}`}
                      className="flex items-center gap-2 rounded-lg border border-amber-400/15 bg-amber-500/8 px-2.5 py-1.5"
                    >
                      <span className="w-8 flex-none font-sans text-[11px] font-black text-yellow-300">
                        {"★".repeat(index + 1)}
                      </span>
                      {constraint.icon && (
                        <img
                          src={constraint.icon}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded-full object-cover"
                          draggable={false}
                        />
                      )}
                      <span className="font-sans text-[11px] leading-tight text-amber-200/80">
                        {constraint.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {PLAYTEST_ACTIVE && (
            <div className="mt-3">
              <PlaytestSeedControl />
            </div>
          )}

          {/* Action */}
          {canPlay && (
            <div className="mt-3">
              <ArcadeButton onClick={onPlay} disabled={starting}>
                {starting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Preparing…
                  </>
                ) : isBossLevel ? (
                  `Face ${guardian.name}`
                ) : isCleared ? (
                  "Replay"
                ) : (
                  "Play"
                )}
              </ArcadeButton>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default LevelPreview;
