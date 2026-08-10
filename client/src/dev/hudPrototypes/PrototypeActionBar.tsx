/**
 * DEV-ONLY bottom controls: three buttons on the stone, no panel.
 *
 * The framed tray spent 108px — a ninth of the phone — presenting one thing you
 * ever press. A thumb-sized key with its counts as badges says the same in 68,
 * and the badge is the better readout anyway: a charge count belongs on the
 * thing it charges, not beside it.
 *
 * Home, bonus, settings. Giving up lives inside settings rather than sitting on
 * the board: it abandons on chain — terminal, zero stars, the entry gone — so
 * one stray thumb should never reach it, and it still asks before it does it.
 */
import { useEffect, useState } from "react";
import { Flag, Home, Settings, Volume2, VolumeX } from "lucide-react";

import { useMusicPlayer } from "@/contexts/hooks";
import { Button } from "@/ui/elements/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/elements/dialog";
import { Slider } from "@/ui/elements/slider";
import type { BonusSlot } from "@/ui/components/actionbar/GameActionBar";

const ROUND_KEY: React.CSSProperties = {
  background: "linear-gradient(180deg, #2A3348 0%, #141B2A 100%)",
  boxShadow: "0 3px 0 #05080F, inset 0 2px 0 rgba(255,255,255,0.14)",
};

export default function PrototypeActionBar({
  bonusSlots,
  activeBonus,
  onSurrender,
  onHome,
}: {
  bonusSlots: BonusSlot[];
  activeBonus: number;
  onSurrender: () => void;
  onHome?: () => void;
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
  const slot = bonusSlots[0];
  const selected = slot !== undefined && activeBonus === slot.type;
  const spent = slot === undefined || slot.charges <= 0;
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  useEffect(() => {
    if (!confirmingQuit) return;
    const timer = window.setTimeout(() => setConfirmingQuit(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmingQuit]);

  return (
    <div className="flex w-full items-center justify-between px-5 pb-5 pt-1">
      <button
        type="button"
        aria-label="Home"
        onClick={onHome}
        className="grid h-11 w-11 flex-none place-items-center rounded-full text-white/60 transition-transform active:translate-y-[2px]"
        style={ROUND_KEY}
      >
        <Home size={19} />
      </button>

      <button
        type="button"
        aria-label={slot ? `${slot.name}: ${slot.charges} charges` : "No bonus"}
        onClick={spent ? undefined : slot?.onClick}
        disabled={spent}
        className="relative grid h-[62px] w-[62px] flex-none place-items-center rounded-full transition-transform active:translate-y-[3px] disabled:translate-y-0"
        style={{
          background: spent
            ? "linear-gradient(180deg, #232B3D 0%, #121826 100%)"
            : selected
              ? "linear-gradient(160deg, #FFF6CE 0%, #FDE047 55%, #C99C0C 100%)"
              : "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)",
          boxShadow: spent
            ? "0 4px 0 #05080F, inset 0 1px 0 rgba(255,255,255,0.08)"
            : `0 5px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.55)${
                selected ? ", 0 0 22px rgba(250,204,21,0.6)" : ""
              }`,
        }}
      >
        {slot && (
          <img
            src={slot.icon}
            alt=""
            className="h-8 w-8 object-contain"
            style={{ opacity: spent ? 0.35 : 1 }}
          />
        )}
        {/* Counts ride the thing they count. */}
        {slot && (
          <span
            className="absolute -bottom-0.5 -right-0.5 grid h-6 min-w-[24px] place-items-center rounded-full px-1 font-sans text-[13px] font-black tabular-nums"
            style={{
              background: spent
                ? "linear-gradient(180deg, #3A4459, #202836)"
                : "linear-gradient(180deg, #FFF3C4, #E0A800)",
              color: spent ? "rgba(255,255,255,0.4)" : "#241903",
              boxShadow:
                "0 2px 0 rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            {slot.charges}
          </span>
        )}
        {slot?.lineProgress && (
          <span
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-[1px] font-sans text-[10px] font-black tabular-nums text-[#FDE68A]"
            style={{
              background: "rgba(6,10,18,0.92)",
              boxShadow: "inset 0 0 0 1px rgba(250,204,21,0.32)",
            }}
          >
            {slot.lineProgress.current}/{slot.lineProgress.threshold}
          </span>
        )}
      </button>

      <Dialog>
        <DialogTrigger
          type="button"
          aria-label="Settings"
          className="grid h-11 w-11 flex-none place-items-center rounded-full border-0 text-white/60 transition-transform active:translate-y-[2px]"
          style={ROUND_KEY}
        >
          <Settings size={19} />
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

          {/* Terminal and irreversible, so it asks — and it asks in here rather
              than from a button the thumb rests next to all run. */}
          <button
            type="button"
            onClick={() => {
              if (confirmingQuit) {
                onSurrender();
                return;
              }
              setConfirmingQuit(true);
            }}
            className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 font-sans text-sm font-bold text-red-200"
          >
            <Flag size={15} />
            {confirmingQuit
              ? "Give up — this ends the run for good"
              : "Give up this run"}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
