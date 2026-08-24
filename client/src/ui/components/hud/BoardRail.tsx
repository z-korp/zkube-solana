/**
 * The bottom of the in-run screen.
 *
 * One thing here is raised, and it is the only thing that is ever pressed in
 * anger. Home and settings are cut INTO the rail rather than sitting on it —
 * hierarchy by material rather than by size, because three circles of equal
 * weight is what made this bar read as three equal choices when two of them
 * are used twice a run.
 *
 * The move meter is an inlay line along the rail's top edge, not a pill
 * floating under the keys, and it DRAINS: it starts full and empties, in the
 * realm's accent, going red on the last quarter. In Campaign the star
 * thresholds are marks it drains past, because stars are decided by moves used
 * — the counter and the three stars were always one instrument.
 */
import { useEffect, useState } from "react";
import { Flag, Home, Settings, Volume2, VolumeX } from "lucide-react";
import { motion } from "motion/react";

import { useMusicPlayer } from "@/contexts/hooks";
import { getThemeColors, type ThemeId } from "@/config/themes";
import { Button } from "@/ui/elements/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/elements/dialog";
import { Slider } from "@/ui/elements/slider";
import type { BonusSlot } from "./bonusSlot";

const SEAT: React.CSSProperties = {
  background: "linear-gradient(180deg,#0A0D08,#171B12)",
  boxShadow:
    "inset 0 3px 7px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(201,169,110,0.2)",
};

export interface BoardRailProps {
  themeId: ThemeId;
  bonusSlots: BonusSlot[];
  activeBonus: number;
  /** Bumped when a charge is earned, so the key can answer. */
  bonusEarnSignal?: number;
  disabled?: boolean;
  movesRemaining: number;
  maxMoves: number;
  /** Campaign only: the move counts that still earn three and two stars. */
  starThresholds?: readonly [number, number];
  movesUsed: number;
  onHome?: () => void;
  onSurrender: () => void;
  surrenderDisabled?: boolean;
}

export default function BoardRail({
  themeId,
  bonusSlots,
  activeBonus,
  bonusEarnSignal = 0,
  disabled = false,
  movesRemaining,
  maxMoves,
  starThresholds,
  movesUsed,
  onHome,
  onSurrender,
  surrenderDisabled = false,
}: BoardRailProps) {
  const accent = getThemeColors(themeId).accent;
  const left =
    maxMoves > 0 ? Math.max(0, Math.min(1, movesRemaining / maxMoves)) : 0;
  const meter = left <= 0.25 ? "#EF4444" : left <= 0.5 ? "#F59E0B" : accent;

  return (
    <div className="relative w-full flex-none" style={{ height: 139 }}>
      {/* the rail's own lip, and the meter inlaid along it */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "rgba(0,0,0,0.75)" }}
      />
      <div
        className="absolute inset-x-0 overflow-hidden"
        style={{ top: 1, height: 5 }}
      >
        <motion.div
          className="h-full"
          initial={false}
          animate={{ width: `${left * 100}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          style={{
            background: `linear-gradient(90deg, ${meter}44, ${meter})`,
            boxShadow: `0 0 10px ${meter}88`,
          }}
        />
        {starThresholds?.map((threshold, index) => {
          const at = maxMoves > 0 ? 1 - threshold / maxMoves : 0;
          const earned = movesUsed <= threshold;
          return (
            <span
              key={index}
              className="absolute top-0 h-full"
              style={{
                left: `${Math.max(0, Math.min(1, at)) * 100}%`,
                width: 2,
                background: earned ? "#FACC15" : "rgba(255,255,255,0.28)",
              }}
            />
          );
        })}
      </div>

      <div className="absolute left-4 top-4 flex items-baseline gap-1.5">
        <span className="font-sans text-[15px] font-black tabular-nums text-white">
          {movesRemaining}
        </span>
        <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/40">
          moves left
        </span>
      </div>

      <button
        type="button"
        aria-label="Home"
        onClick={onHome}
        disabled={!onHome}
        className="absolute grid place-items-center rounded-full text-white/70 transition-transform active:translate-y-[1px] disabled:opacity-40"
        style={{ ...SEAT, left: 34, top: 54, width: 44, height: 44 }}
      >
        <Home size={16} />
      </button>

      <div
        className="absolute flex items-center justify-center gap-2"
        style={{ left: "50%", top: 50, transform: "translateX(-50%)" }}
      >
        {bonusSlots.map((slot, index) => {
          const selected =
            typeof slot.type === "number" && activeBonus === slot.type;
          const spent = slot.charges <= 0;
          return (
            <motion.button
              type="button"
              aria-label={`${slot.name}: ${slot.charges} charges`}
              onClick={spent || disabled ? undefined : slot.onClick}
              disabled={spent || disabled}
              key={slot.type}
              animate={
                index === 0 && bonusEarnSignal > 0
                  ? { scale: [1, 1.12, 1] }
                  : {}
              }
              transition={{ duration: 0.3 }}
              className="relative grid place-items-center rounded-full transition-transform active:translate-y-[3px] disabled:translate-y-0"
              style={{
                width: bonusSlots.length > 1 ? 64 : 78,
                height: bonusSlots.length > 1 ? 64 : 78,
                background: spent
                  ? "linear-gradient(170deg,#232B3D,#121826)"
                  : "linear-gradient(170deg,#FFF3C4,#FACC15 48%,#8A6B08)",
                boxShadow: spent
                  ? "0 4px 0 #05080F, inset 0 1px 0 rgba(255,255,255,0.08)"
                  : `inset 0 2px 0 rgba(255,255,255,0.55), 0 5px 0 #5C4805, 0 10px 16px rgba(0,0,0,0.55)${
                      selected ? ", 0 0 22px rgba(250,204,21,0.65)" : ""
                    }`,
              }}
            >
              <img
                src={slot.icon}
                alt=""
                className="h-[44%] w-[44%] object-contain"
                style={{ opacity: spent ? 0.35 : 1 }}
              />
              <span
                className="absolute -bottom-0.5 -right-0.5 grid h-[25px] min-w-[25px] place-items-center rounded-full px-1 font-sans text-[12px] font-black tabular-nums"
                style={{
                  background: spent
                    ? "linear-gradient(180deg,#3A4459,#202836)"
                    : "linear-gradient(180deg,#FFF3C4,#E0A800)",
                  color: spent ? "rgba(255,255,255,0.4)" : "#241903",
                  boxShadow: "0 2px 0 rgba(0,0,0,0.6)",
                }}
              >
                {slot.charges}
              </span>
              {slot.lineProgress && (
                <span
                  className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-[1px] font-sans text-[10px] font-black tabular-nums text-[#FDE68A]"
                  style={{
                    background: "rgba(6,10,18,0.92)",
                    boxShadow: "inset 0 0 0 1px rgba(250,204,21,0.32)",
                  }}
                >
                  {slot.lineProgress.current}/{slot.lineProgress.threshold}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      <SettingsSeat
        onSurrender={onSurrender}
        surrenderDisabled={surrenderDisabled}
      />
    </div>
  );
}

function SettingsSeat({
  onSurrender,
  surrenderDisabled,
}: {
  onSurrender: () => void;
  surrenderDisabled: boolean;
}) {
  const {
    isPlaying,
    playTheme,
    stopTheme,
    musicVolume,
    setMusicVolume,
    effectsVolume,
    setEffectsVolume,
  } = useMusicPlayer();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <Dialog>
      <DialogTrigger
        type="button"
        aria-label="Settings"
        className="absolute grid place-items-center rounded-full border-0 text-white/70 transition-transform active:translate-y-[1px]"
        style={{ ...SEAT, right: 34, top: 54, width: 44, height: 44 }}
      >
        <Settings size={16} />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => (isPlaying ? stopTheme() : playTheme())}
            >
              {isPlaying ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Music</span>
              <Slider
                value={[musicVolume]}
                onValueChange={(value) => setMusicVolume(value[0])}
                max={1}
                step={0.05}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(musicVolume * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Effects</span>
              <Slider
                value={[effectsVolume]}
                onValueChange={(value) => setEffectsVolume(value[0])}
                max={1}
                step={0.05}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(effectsVolume * 100)}%
            </span>
          </div>
        </div>

        {/* Terminal and irreversible, so it asks — and it lives in here rather
            than on a button the thumb rests beside for a whole run. */}
        <button
          type="button"
          disabled={surrenderDisabled}
          onClick={() => {
            if (confirming) {
              onSurrender();
              return;
            }
            setConfirming(true);
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 font-sans text-sm font-bold text-red-200 disabled:opacity-40"
        >
          <Flag size={15} />
          {confirming
            ? "Give up — this ends the run for good"
            : "Give up this run"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
