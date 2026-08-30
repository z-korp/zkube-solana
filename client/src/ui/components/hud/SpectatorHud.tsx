import { ArrowLeft, Flame } from "lucide-react";
import { motion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import type { ActiveRunConstraintView } from "@/core/runProjection";
import type { ActiveRunView } from "@/chain/runPlan";
import {
  HUD_BAR,
  HudBarSvg,
  circleToPercent,
  rectToPercent,
} from "@/ui/components/chrome";
import { constraintStatus } from "@/ui/components/hud/constraintDisplay";

// PARKED 2026-08-29 — owner ruling; not reachable from the product until unparked
export default function SpectatorHud({
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
  const constraints = [
    {
      slot: "Shape" as const,
      rule: run.rules.primary,
      progress: run.primaryProgress,
    },
    {
      slot: "Blow" as const,
      rule: run.rules.secondary,
      progress: run.secondaryProgress,
    },
  ].filter(({ rule }) => rule.kind !== 0);

  return (
    <div className="relative mx-auto w-full max-w-[560px] shrink-0 px-1 pt-1">
      <HudBarSvg
        latchedStarSources={run.latchedStarSources}
        daily={run.mode === "daily"}
      />
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
            {displayScore.toLocaleString()} /{" "}
            {run.rules.pointsRequired.toLocaleString()}
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
          <Flame className="h-3 w-3" /> {run.comboCounter}
        </motion.div>

        {constraints.map(({ slot, rule, progress }, index) => (
          <ConstraintBadge
            key={`${rule.kind}-${index}`}
            slot={slot}
            rule={rule}
            progress={progress}
            latched={(run.latchedStarSources & (1 << (index + 1))) !== 0}
            side={index === 0 ? "left" : "right"}
          />
        ))}
      </div>
      <div className="-mt-4 text-center text-[9px] font-bold uppercase tracking-[0.22em] text-white/40 sm:-mt-6">
        {run.mode === "daily"
          ? "Daily challenge"
          : `Map ${run.mapId} · Level ${run.level}`}
        {run.rules.activeMutatorId > 0
          ? ` · Guardian ${run.rules.activeMutatorId}`
          : ""}
      </div>
    </div>
  );
}

function ConstraintBadge({
  slot,
  rule,
  progress,
  latched,
  side,
}: {
  slot: "Shape" | "Blow";
  rule: ActiveRunConstraintView;
  progress: number;
  latched: boolean;
  side: "left" | "right";
}) {
  const measured = constraintStatus(
    rule.kind,
    rule.value,
    rule.requiredCount,
    progress,
  );
  const status = { ...measured, complete: latched };
  return (
    <div
      className={`absolute top-[67%] flex w-[30%] flex-col rounded-lg border px-2 py-1 text-[clamp(6px,1.5vw,9px)] font-bold backdrop-blur ${
        status.complete
          ? "border-emerald-300/50 bg-emerald-950/80 text-emerald-200"
          : "border-cyan-300/30 bg-slate-950/80 text-cyan-100"
      } ${
        side === "left"
          ? "left-[22%] -translate-x-1/2"
          : "right-[22%] translate-x-1/2"
      }`}
      aria-label={`${slot}: ${status.description}`}
    >
      <span className="text-[0.8em] font-black uppercase tracking-[0.14em] text-cyan-300/70">
        {slot}
      </span>
      <span className="truncate" title={status.description}>
        {status.description}
      </span>
      {status.class === "cumulative" ? (
        <span className="mt-0.5 flex items-center gap-1">
          <span
            className="h-1 flex-1 overflow-hidden rounded-full bg-black/60"
            role="progressbar"
            aria-label={`${slot} progress`}
            aria-valuemin={0}
            aria-valuemax={status.required}
            aria-valuenow={status.progress}
          >
            <span
              className={`block h-full ${status.complete ? "bg-emerald-300" : "bg-cyan-300"}`}
              style={{
                width: `${(status.progress / status.required) * 100}%`,
              }}
            />
          </span>
          <span className="tabular-nums">
            {status.progress}/{status.required}
          </span>
        </span>
      ) : (
        <span
          className={status.complete ? "text-emerald-300" : "text-amber-300"}
        >
          {status.complete ? "✓ Landed" : "◇ Waiting"}
        </span>
      )}
    </div>
  );
}
