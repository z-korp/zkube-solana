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
 * realm's accent, going red on the last quarter.
 */
import { useEffect, useRef, useState } from "react";
import { Flag, Home, Settings } from "lucide-react";
import { motion } from "motion/react";

import { getThemeColors, type ThemeId } from "@/config/themes";
import { useNavigationStore } from "@/stores/navigationStore";
import { formatCountdown } from "@/utils/time";
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
  onHome?: () => void;
  onSurrender: () => void;
  surrenderDisabled?: boolean;
  runId?: bigint;
  /** Present only for Arcade, whose run freezes at the Daily deadline. */
  deadlineSecondsRemaining?: number;
}

export default function BoardRail({
  themeId,
  bonusSlots,
  activeBonus,
  bonusEarnSignal = 0,
  disabled = false,
  movesRemaining,
  maxMoves,
  onHome,
  onSurrender,
  surrenderDisabled = false,
  runId,
  deadlineSecondsRemaining,
}: BoardRailProps) {
  const accent = getThemeColors(themeId).accent;
  const left =
    maxMoves > 0 ? Math.max(0, Math.min(1, movesRemaining / maxMoves)) : 0;
  const meter = left <= 0.25 ? "#EF4444" : left <= 0.5 ? "#F59E0B" : accent;
  const [help, setHelp] = useState<string | null>(null);
  const firstBonusTapSeen = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const chargeSlot = bonusSlots.find((slot) => slot.type !== "reroll");

  useEffect(() => {
    firstBonusTapSeen.current = false;
    setHelp(null);
  }, [runId]);

  useEffect(() => {
    if (!help) return;
    const timer = window.setTimeout(() => setHelp(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [help]);

  useEffect(
    () => () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
    },
    [],
  );

  const startLongPress = (slot: BonusSlot) => {
    longPressed.current = false;
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setHelp(slot.description);
    }, 550);
  };

  const stopLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div
      className="relative w-full flex-none"
      style={{ height: "calc(164px + env(safe-area-inset-bottom))" }}
    >
      <div className="relative w-full" style={{ height: 164 }}>
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
      </div>

      <div className="absolute left-4 top-4 flex items-baseline gap-1.5">
        <span className="font-sans text-[15px] font-black tabular-nums text-white">
          {movesRemaining}
        </span>
        <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/40">
          moves left
        </span>
      </div>

      {deadlineSecondsRemaining !== undefined && (
        <span className="absolute right-4 top-4 font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">
          Freezes in {formatCountdown(deadlineSecondsRemaining)}
        </span>
      )}

      {help && (
        <p
          role="status"
          className="absolute left-1/2 top-2 z-20 w-[250px] -translate-x-1/2 rounded-lg border border-white/15 bg-black/95 px-2.5 py-1.5 text-center font-sans text-[10px] font-semibold text-white/90"
        >
          {help}
        </p>
      )}

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
              aria-label={`${slot.name}: ${slot.charges} charges${slot.totemTarget ? `; width ${slot.totemTarget.width} removes ${slot.totemTarget.cells} cells` : ""}`}
              onPointerDown={() => startLongPress(slot)}
              onPointerUp={stopLongPress}
              onPointerCancel={stopLongPress}
              onPointerLeave={stopLongPress}
              onContextMenu={(event) => {
                event.preventDefault();
                setHelp(slot.description);
              }}
              onClick={
                spent || disabled
                  ? undefined
                  : () => {
                      if (longPressed.current) {
                        longPressed.current = false;
                        return;
                      }
                      if (
                        slot.type !== "reroll" &&
                        !firstBonusTapSeen.current
                      ) {
                        firstBonusTapSeen.current = true;
                        setHelp(slot.description);
                      }
                      slot.onClick();
                    }
              }
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
              {slot.totemTarget && (
                <span
                  className="absolute left-1 top-1 rounded-md bg-black/80 px-1 py-0.5 font-sans text-[9px] font-black tabular-nums text-cyan-200"
                  title={`${slot.totemTarget.cells} cells in width-${slot.totemTarget.width} blocks`}
                >
                  ×{slot.totemTarget.cells}
                </span>
              )}
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
              {slot.triggerProgress && (
                <span
                  className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-[1px] font-sans text-[10px] font-black tabular-nums text-[#FDE68A]"
                  style={{
                    background: "rgba(6,10,18,0.92)",
                    boxShadow: "inset 0 0 0 1px rgba(250,204,21,0.32)",
                  }}
                >
                  {slot.triggerProgress.current}/
                  {slot.triggerProgress.threshold}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {chargeSlot && (
        <p className="absolute inset-x-[108px] bottom-2 text-center font-sans text-[9px] font-semibold leading-tight text-amber-100/70">
          {chargeSlot.triggerDescription}
          {chargeSlot.triggerProgress && (
            <span className="ml-1 whitespace-nowrap text-amber-200">
              {chargeSlot.triggerProgress.current}/
              {chargeSlot.triggerProgress.threshold}
              {chargeSlot.triggerProgress.suffix
                ? ` ${chargeSlot.triggerProgress.suffix}`
                : " to next"}
            </span>
          )}
        </p>
      )}

        <UtilitySeats
          onSurrender={onSurrender}
          surrenderDisabled={surrenderDisabled}
        />
      </div>
    </div>
  );
}

function UtilitySeats({
  onSurrender,
  surrenderDisabled,
}: {
  onSurrender: () => void;
  surrenderDisabled: boolean;
}) {
  const openSettings = useNavigationStore((state) => state.openSettings);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={openSettings}
        className="absolute grid place-items-center rounded-full border-0 text-white/70 transition-transform active:translate-y-[1px]"
        style={{ ...SEAT, right: 34, top: 54, width: 44, height: 44 }}
      >
        <Settings size={16} />
      </button>
      <button
        type="button"
        aria-label={confirming ? "Confirm give up" : "Give up this run"}
        title={confirming ? "Tap again to give up" : "Give up this run"}
        disabled={surrenderDisabled}
        onClick={() => {
          if (confirming) {
            onSurrender();
            return;
          }
          setConfirming(true);
        }}
        className="absolute grid place-items-center rounded-full border border-red-300/20 text-red-200/80 transition-transform active:translate-y-[1px] disabled:opacity-30"
        style={{ ...SEAT, right: 84, top: 61, width: 32, height: 32 }}
      >
        <Flag size={13} />
      </button>
    </>
  );
}
