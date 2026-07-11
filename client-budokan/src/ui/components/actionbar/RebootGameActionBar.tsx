import { useState } from "react";
import { Flag, Settings, Volume2, VolumeX } from "lucide-react";
import { BonusType } from "@/solana/reboot/bonusTypes";
import { useMusicPlayer } from "@/contexts/hooks";
import {
  ACTION_BAR,
  ActionBarSvg,
  circleToPercent,
} from "@/ui/components/chrome";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/elements/dialog";

export default function RebootGameActionBar({
  bonusType,
  bonusCharges,
  activeBonus,
  onToggleBonus,
  onExit,
}: {
  bonusType: number;
  bonusCharges: number;
  activeBonus: BonusType;
  onToggleBonus: () => void;
  onExit: () => void;
}) {
  const {
    musicVolume,
    effectsVolume,
    setMusicVolume,
    setEffectsVolume,
    isPlaying,
    playTheme,
    stopTheme,
  } = useMusicPlayer();
  const [soundOpen, setSoundOpen] = useState(false);
  const selected = activeBonus !== BonusType.None;

  return (
    <div className="mx-auto w-full max-w-[420px] shrink-0 px-2 pb-1">
      {selected && (
        <div className="text-center text-[10px] font-black uppercase tracking-widest text-yellow-300">
          Select a block to use {bonusName(bonusType)}
        </div>
      )}
      <div className="relative">
        <ActionBarSvg />
        <div className="absolute inset-0">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Leave run"
                className="absolute flex items-center justify-center rounded-full text-red-400 transition hover:scale-105 hover:text-red-300"
                style={circleToPercent(ACTION_BAR.sockets.surrender, ACTION_BAR.viewBox)}
              >
                <Flag className="h-[40%] w-[40%]" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Leave this run?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Your MagicBlock run remains resumable on this device. Leaving does not settle or discard it.
              </p>
              <div className="flex gap-3">
                <DialogClose className="flex-1 rounded-lg border px-4 py-2">Stay</DialogClose>
                <DialogClose onClick={onExit} className="flex-1 rounded-lg bg-red-600 px-4 py-2 font-bold text-white">Leave</DialogClose>
              </div>
            </DialogContent>
          </Dialog>

          <button
            type="button"
            disabled={bonusType === BonusType.None || bonusCharges === 0}
            onClick={onToggleBonus}
            aria-pressed={selected}
            className={`absolute flex items-center justify-center rounded-full transition disabled:opacity-35 ${selected ? "drop-shadow-[0_0_10px_rgba(250,204,21,.8)]" : ""}`}
            style={circleToPercent(ACTION_BAR.sockets.bonus, ACTION_BAR.viewBox)}
          >
            {bonusType === BonusType.None ? (
              <span className="text-2xl text-white/25">◇</span>
            ) : (
              <>
                <img src={bonusIcon(bonusType)} alt={bonusName(bonusType)} className="h-[62%] w-[62%] object-contain" />
                <span className="absolute bottom-0 right-0 grid h-5 min-w-5 place-items-center rounded-full bg-yellow-500 px-1 text-[10px] font-black text-black">{bonusCharges}</span>
              </>
            )}
          </button>

          <button
            type="button"
            aria-label="Sound settings"
            onClick={() => setSoundOpen(true)}
            className="absolute flex items-center justify-center rounded-full text-slate-300 transition hover:scale-105 hover:text-white"
            style={circleToPercent(ACTION_BAR.sockets.settings, ACTION_BAR.viewBox)}
          >
            <Settings className="h-[40%] w-[40%]" />
          </button>
        </div>
      </div>

      <Dialog open={soundOpen} onOpenChange={setSoundOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sound settings</DialogTitle>
          </DialogHeader>
          <label className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => (isPlaying ? stopTheme() : playTheme())}>
              {isPlaying ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <span className="w-12">Music</span>
            <input className="flex-1" type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} />
            <span className="w-9 text-right">{Math.round(musicVolume * 100)}%</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-[18px]" />
            <span className="w-12">Effects</span>
            <input className="flex-1" type="range" min="0" max="1" step="0.05" value={effectsVolume} onChange={(event) => setEffectsVolume(Number(event.target.value))} />
            <span className="w-9 text-right">{Math.round(effectsVolume * 100)}%</span>
          </label>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function bonusName(value: number): string {
  return value === BonusType.Hammer
    ? "Hammer"
    : value === BonusType.Totem
      ? "Totem"
      : value === BonusType.Wave
        ? "Wave"
        : "Bonus";
}

function bonusIcon(value: number): string {
  return value === BonusType.Hammer
    ? "/assets/common/bonus/hammer.png"
    : value === BonusType.Totem
      ? "/assets/common/bonus/tiki.png"
      : "/assets/common/bonus/wave.png";
}
