import { ArrowLeft, Flame } from "lucide-react";
import { motion } from "motion/react";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import type {
  ActiveRunConstraintView,
  ActiveRunView,
} from "@/solana/reboot/runPlan";
import {
  HUD_BAR,
  HudBarSvg,
  circleToPercent,
  rectToPercent,
} from "@/ui/components/chrome";

export default function RebootGameHud({
  run,
  onBack,
}: {
  run: ActiveRunView;
  onBack: () => void;
}) {
  const guardian = getZoneGuardian(run.mapId);
  const movesRemaining = Math.max(0, run.rules.maxMoves - run.moves);
  const displayScore =
    useLerpNumber(run.score, { integer: true, duration: 500 }) ?? run.score;
  const scoreProgress = Math.min(
    1,
    run.rules.pointsRequired > 0 ? displayScore / run.rules.pointsRequired : 0,
  );
  const stars = estimateStars(
    run.rules.maxMoves,
    run.moves,
    run.rules.starThresholdModifier,
  );
  const constraints = [
    { rule: run.rules.primary, progress: run.primaryProgress },
    { rule: run.rules.secondary, progress: run.secondaryProgress },
  ].filter(({ rule }) => rule.kind !== 0);

  return (
    <div className="relative mx-auto w-full max-w-[560px] shrink-0 px-1 pt-1">
      <HudBarSvg starsEarned={stars} endless={run.mode === "daily"} />
      <div className="absolute inset-x-1 top-1 aspect-[500/152]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Leave run"
          className="absolute z-10 flex items-center justify-center rounded-full bg-black/25 text-white/80 transition hover:text-white"
          style={circleToPercent(HUD_BAR.sockets.guardian, HUD_BAR.viewBox)}
        >
          <img
            src={getGuardianPortrait(run.mapId)}
            alt={guardian.name}
            className="h-full w-full rounded-full object-cover"
          />
          <span className="absolute -left-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-white/20 bg-black/75">
            <ArrowLeft size={13} />
          </span>
        </button>

        <div
          className="absolute overflow-hidden rounded bg-black/50"
          style={rectToPercent(HUD_BAR.sockets.scoreBar, HUD_BAR.viewBox)}
        >
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-[width] duration-300"
            style={{ width: `${scoreProgress * 100}%` }}
          />
          <span className="absolute inset-0 grid place-items-center text-[clamp(8px,2vw,12px)] font-black tracking-wide text-white drop-shadow">
            {displayScore.toLocaleString()} / {run.rules.pointsRequired.toLocaleString()}
          </span>
        </div>

        <div
          className="absolute flex flex-col items-center justify-center text-white"
          style={circleToPercent(HUD_BAR.sockets.moves, HUD_BAR.viewBox)}
        >
          <strong className="text-[clamp(14px,4vw,25px)] leading-none text-cyan-200">
            {movesRemaining}
          </strong>
          <span className="text-[clamp(6px,1.5vw,9px)] uppercase tracking-widest text-white/45">
            moves
          </span>
        </div>

        <motion.div
          key={run.comboCounter}
          animate={run.comboCounter > 0 ? { scale: [1, 1.3, 1] } : {}}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={`absolute flex items-center justify-center gap-1 text-[clamp(8px,2vw,12px)] font-black ${
            run.comboCounter >= 3
              ? "text-yellow-300 drop-shadow-[0_0_6px_rgba(250,204,21,.9)]"
              : "text-orange-300"
          }`}
          style={rectToPercent(HUD_BAR.sockets.combo, HUD_BAR.viewBox)}
        >
          <Flame className="h-3 w-3" /> ×{run.comboCounter}
        </motion.div>

        {constraints.map(({ rule, progress }, index) => (
          <ConstraintBadge
            key={`${rule.kind}-${index}`}
            rule={rule}
            progress={progress}
            side={index === 0 ? "left" : "right"}
          />
        ))}
      </div>
      <div className="-mt-4 text-center text-[9px] font-bold uppercase tracking-[0.22em] text-white/40 sm:-mt-6">
        {run.mode === "daily" ? "Daily challenge" : `Map ${run.mapId} · Level ${run.level}`}
        {run.rules.activeMutatorId > 0
          ? ` · Mutator ${run.rules.activeMutatorId}`
          : ""}
      </div>
    </div>
  );
}

function ConstraintBadge({
  rule,
  progress,
  side,
}: {
  rule: ActiveRunConstraintView;
  progress: number;
  side: "left" | "right";
}) {
  const required = rule.kind === 3 ? 1 : rule.requiredCount;
  const complete = progress >= required;
  return (
    <div
      className={`absolute top-[69%] flex items-center gap-1.5 rounded-full border px-2 py-1 text-[clamp(7px,1.8vw,10px)] font-bold backdrop-blur ${
        complete
          ? "border-emerald-300/50 bg-emerald-950/80 text-emerald-200"
          : "border-cyan-300/30 bg-slate-950/80 text-cyan-100"
      } ${side === "left" ? "left-[22%] -translate-x-1/2" : "right-[22%] translate-x-1/2"}`}
      title={constraintDescription(rule)}
    >
      <span>{constraintIcon(rule.kind)}</span>
      <span>{progress}/{required}</span>
    </div>
  );
}

function constraintIcon(kind: number): string {
  return kind === 1 ? "▰" : kind === 2 ? "◆" : "🔥";
}

function constraintDescription(rule: ActiveRunConstraintView): string {
  if (rule.kind === 1)
    return `Clear ${rule.value}+ lines in one move ${rule.requiredCount} times`;
  if (rule.kind === 2)
    return `Break ${rule.requiredCount} blocks of size ${rule.value}`;
  if (rule.kind === 3) return `Reach a ${rule.value}× combo`;
  return "No constraint";
}

export function estimateStars(
  maxMoves: number,
  movesUsed: number,
  modifier: number,
): number {
  const positive = modifier >= 128;
  const magnitude = positive ? modifier - 128 : 128 - modifier;
  const change = magnitude * 5;
  const threePercent = positive
    ? Math.max(10, 50 - change)
    : Math.min(90, 50 + change);
  const twoPercent = positive
    ? Math.max(threePercent + 1, 75 - change)
    : Math.min(99, 75 + change);
  if (movesUsed <= Math.floor((maxMoves * threePercent) / 100)) return 3;
  if (movesUsed <= Math.floor((maxMoves * twoPercent) / 100)) return 2;
  return 1;
}
