/**
 * DEV-ONLY bottom-panel prototype, the third pane of the tablet.
 *
 * Same width and same frame as the header and the grid, so the screen reads as
 * one object rather than three floating widgets.
 *
 * The rework, beyond the paint:
 *
 * - THE BONUS IS THE ONLY THING YOU PLAY WITH DOWN HERE, so it is the only
 *   thing that looks pressable — a full-width key with a real under-edge,
 *   charges as pips, and the trigger progress as its own meter. Previously the
 *   most important control was the same size as "settings" and its progress was
 *   a 7px chip floating off its shoulder.
 * - BACK MOVED HERE from the top-left corner of the HUD, where it sat inside
 *   the score furniture.
 * - GIVING UP TAKES TWO TAPS. It abandons on chain — terminal, zero stars, the
 *   entry gone — and it was one tap away from the board the whole run.
 */
import { useEffect, useState } from "react";
import { ChevronLeft, Flag } from "lucide-react";

import type { BonusSlot } from "@/ui/components/actionbar/GameActionBar";
import { FRAME, FRAME_INNER } from "./frame";

function StoneKey({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick?: () => void;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-[52px] w-[52px] flex-none place-items-center rounded-2xl transition-transform active:translate-y-[2px]"
      style={{
        background: "linear-gradient(180deg, #2A3348 0%, #151C2C 100%)",
        boxShadow: "0 4px 0 #05080F, inset 0 2px 0 rgba(255,255,255,0.14)",
        color: tone ?? "rgba(255,255,255,0.62)",
      }}
    >
      {children}
    </button>
  );
}

export default function PrototypeActionBar({
  bonusSlots,
  activeBonus,
  onSurrender,
  onBack,
  frameWidth,
}: {
  bonusSlots: BonusSlot[];
  activeBonus: number;
  onSurrender: () => void;
  onBack?: () => void;
  frameWidth: number | null;
}) {
  const slot = bonusSlots[0];
  const selected = slot !== undefined && activeBonus === slot.type;
  const spent = slot === undefined || slot.charges <= 0;
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  useEffect(() => {
    if (!confirmingQuit) return;
    const timer = window.setTimeout(() => setConfirmingQuit(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmingQuit]);

  const progress = slot?.lineProgress;

  return (
    <div className="w-full px-1 pb-1.5 pt-1">
      {/* max-width for the same reason as the header: this pane is sized from
          the board and must never be able to widen it back. */}
      <div
        className="mx-auto"
        style={{ ...FRAME, width: frameWidth ?? undefined, maxWidth: "100%" }}
      >
        <div className="flex items-center gap-2 p-2" style={FRAME_INNER}>
          <StoneKey label="Back" onClick={onBack}>
            <ChevronLeft size={20} />
          </StoneKey>

          <button
            type="button"
            aria-label={
              slot ? `${slot.name}: ${slot.charges} charges` : "No bonus"
            }
            onClick={spent ? undefined : slot?.onClick}
            disabled={spent}
            className="relative flex h-[58px] min-w-0 flex-1 items-center justify-center gap-2.5 rounded-2xl px-2 transition-transform active:translate-y-[3px] disabled:translate-y-0"
            style={{
              background: spent
                ? "linear-gradient(180deg, #232B3D 0%, #121826 100%)"
                : selected
                  ? "linear-gradient(160deg, #FFF6CE 0%, #FDE047 55%, #C99C0C 100%)"
                  : "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)",
              boxShadow: spent
                ? "0 4px 0 #05080F, inset 0 1px 0 rgba(255,255,255,0.08)"
                : `0 5px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.55)${
                    selected ? ", 0 0 22px rgba(250,204,21,0.55)" : ""
                  }`,
              color: spent ? "rgba(255,255,255,0.35)" : "#241903",
            }}
          >
            {slot && (
              <img
                src={slot.icon}
                alt=""
                className="h-8 w-8 flex-none object-contain"
                style={{ opacity: spent ? 0.4 : 1 }}
              />
            )}
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate font-sans text-[15px] font-black uppercase tracking-[0.04em]">
                {slot?.name ?? "No bonus"}
              </span>
              {progress && !spent && (
                <span className="mt-0.5 flex items-center gap-1">
                  <span
                    className="block h-[4px] w-14 overflow-hidden rounded-full"
                    style={{ background: "rgba(36,25,3,0.35)" }}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(progress.current / Math.max(1, progress.threshold)) * 100}%`,
                        background: "#241903",
                      }}
                    />
                  </span>
                  <span className="font-sans text-[9px] font-bold uppercase tracking-[0.1em]">
                    next charge
                  </span>
                </span>
              )}
            </span>
            {/* Charges as pips: three of them read at a glance, and an empty
                slot is obviously empty rather than a small zero. */}
            <span className="flex flex-none items-center gap-1">
              {Array.from(
                { length: Math.max(slot?.startingCharges ?? 1, 3) },
                (_, index) => (
                  <span
                    key={index}
                    className="block h-[9px] w-[9px] rounded-full"
                    style={{
                      background:
                        index < (slot?.charges ?? 0)
                          ? "radial-gradient(circle at 35% 30%, #fff, #7A5F00)"
                          : "rgba(36,25,3,0.28)",
                      boxShadow:
                        index < (slot?.charges ?? 0)
                          ? "inset 0 1px 0 rgba(255,255,255,0.8)"
                          : "none",
                    }}
                  />
                ),
              )}
            </span>
          </button>

          <StoneKey
            label={confirmingQuit ? "Confirm give up" : "Give up"}
            onClick={() => {
              if (confirmingQuit) {
                onSurrender();
                return;
              }
              setConfirmingQuit(true);
            }}
            tone={confirmingQuit ? "#FCA5A5" : undefined}
          >
            {confirmingQuit ? (
              <span className="font-sans text-[10px] font-black uppercase leading-tight">
                Sure?
              </span>
            ) : (
              <Flag size={18} />
            )}
          </StoneKey>
        </div>
      </div>
    </div>
  );
}
