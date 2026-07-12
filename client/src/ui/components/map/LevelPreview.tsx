import { motion } from "motion/react";

import type { Game } from "@/game/model";
import { Constraint, ConstraintType } from "@/game/constraint";
import {
  getGuardianPortrait,
  getGuardianStarText,
  getZoneGuardian,
} from "@/config/bossCharacters";
import type { ThemeColors } from "@/config/themes";
import type { GameLevelData } from "@/hooks/useGameLevel";
import type { MapNodeData } from "@/hooks/useMapData";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

export interface LevelPreviewProps {
  node: MapNodeData;
  game: Game | null;
  gameLevel: GameLevelData | null;
  zoneId: number;
  colors: ThemeColors;
  levelStars?: number[];
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

function constraintDescriptions(level: GameLevelData | null): string[] {
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
    .map(({ type, value, count }) =>
      Constraint.fromContractValues(type, value, count).getDescription(),
    );
}

export const LevelPreview: React.FC<LevelPreviewProps> = ({
  node,
  game,
  gameLevel,
  zoneId,
  colors,
  levelStars,
  onPlay,
  onClose,
}) => {
  const guardian = getZoneGuardian(zoneId);
  const isBossLevel = node.type === "boss";
  const levelNum = node.contractLevel;

  const stars =
    levelStars?.[levelNum - 1] ?? game?.getLevelStars(levelNum) ?? 0;
  const isCleared = node.state === "cleared" || node.state === "visited";

  // An active run is authoritative for itself; otherwise the map catalog's
  // exact rule snapshot is authoritative for the preview.
  const levelData =
    gameLevel?.level === levelNum ? gameLevel : node.levelConfig;
  const constraints = constraintDescriptions(levelData);
  const canPlay =
    node.state === "current" ||
    node.state === "available" ||
    node.state === "playing" ||
    node.state === "cleared" ||
    node.state === "visited";

  const guardianLine = isBossLevel
    ? isCleared
      ? guardian.respectLine
      : guardian.trialIntro
    : isCleared
      ? getGuardianStarText(guardian, stars)
      : guardian.encouragement;

  const starRows = levelData
    ? [
        { stars: 3, moves: levelData.star3Threshold },
        { stars: 2, moves: levelData.star2Threshold },
        { stars: 1, moves: levelData.maxMoves },
      ]
    : [];

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
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
            src={getGuardianPortrait(zoneId)}
            alt={guardian.name}
            className="h-full w-auto object-contain"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
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
            <span
              className={`font-sans text-base font-bold ${levelData ? (DIFFICULTY_STYLES[levelData.difficulty] ?? "text-white") : "text-white/50"}`}
            >
              {levelData
                ? (DIFFICULTY_LABELS[levelData.difficulty] ??
                  `Tier ${levelData.difficulty}`)
                : "On-chain"}
            </span>
          </div>

          {/* Guardian quote */}
          <p className="mt-1 font-sans text-[14px] italic text-white/60">
            &quot;{guardianLine}&quot;
          </p>

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
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2.5 text-center">
                <p className="font-sans text-lg font-bold text-white">
                  {levelData?.pointsRequired ?? "—"}
                </p>
                <p className="font-sans text-[10px] text-white/40">Target</p>
              </div>
              <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2.5 text-center">
                <p className="font-sans text-lg font-bold text-white">
                  {levelData?.maxMoves ?? "—"}
                </p>
                <p className="font-sans text-[10px] text-white/40">Moves</p>
              </div>
            </div>

            {/* Star thresholds */}
            {starRows.length > 0 ? (
              <div className="flex gap-1.5">
                {starRows.map(({ stars: rowStars, moves }) => (
                  <div
                    key={rowStars}
                    className="flex-1 rounded-xl bg-white/[0.04] px-2 py-2 text-center"
                  >
                    <p className="text-sm">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <span
                          key={index}
                          className={
                            index < rowStars
                              ? "text-yellow-300"
                              : "text-white/15"
                          }
                        >
                          ★
                        </span>
                      ))}
                    </p>
                    <p className="font-sans text-[11px] font-semibold text-white/50">
                      ≤{moves} moves
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-sans text-[12px] text-white/55">
                Rules will load from the campaign catalog when this run starts.
              </p>
            )}

            {/* Constraints */}
            {constraints.length > 0 && (
              <div className="space-y-1">
                {constraints.map((constraint) => (
                  <p
                    key={constraint}
                    className="rounded-lg border border-amber-400/15 bg-amber-500/8 px-3 py-1.5 font-sans text-[12px] text-amber-200/70"
                  >
                    {constraint}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Action */}
          {canPlay && (
            <div className="mt-3">
              <ArcadeButton onClick={onPlay}>
                {isBossLevel
                  ? `Face ${guardian.name}`
                  : isCleared
                    ? "Replay"
                    : "Play"}
              </ArcadeButton>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default LevelPreview;
