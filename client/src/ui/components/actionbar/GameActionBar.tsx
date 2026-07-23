import { useMemo } from "react";
import { Flag, Settings, Volume2, VolumeX } from "lucide-react";
import { BonusType } from "@/chain/bonusTypes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/elements/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/elements/dialog";

import { Slider } from "@/ui/elements/slider";
import { Button } from "@/ui/elements/button";
import { useMusicPlayer } from "@/contexts/hooks";
import {
  ActionBarSvg,
  ACTION_BAR,
  circleToPercent,
} from "@/ui/components/chrome";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";
import { getMutatorDef, getMutatorEffects } from "@/config/mutatorConfig";

export interface BonusSlot {
  type: BonusType;
  charges: number;
  isActive: boolean; // This is the slot the game rolled
  icon: string;
  name: string;
  description: string;
  triggerDescription: string; // e.g. "Chain 4 combos"
  startingCharges: number;
  onClick: () => void;
}

interface GameActionBarProps {
  bonusSlots: BonusSlot[];
  activeBonus: BonusType; // Currently selected for use (toggled by player)
  bonusDescription: string;
  onSurrender: () => void;
  surrenderDisabled?: boolean;
  /** Inert mode: the bar stays mounted (its height reserves the flex slot so
   * the board never resizes) but bonus interactions are off — used across the
   * terminal/settlement window. */
  disabled?: boolean;
  /** Monotonic counter bumped when a bonus charge is EARNED; keys the badge
   * pop + ring animations so CSS restarts without timers. */
  bonusEarnSignal?: number;
  zoneId?: number;
  activeMutatorId?: number;
}

const GameActionBar: React.FC<GameActionBarProps> = ({
  bonusSlots,
  activeBonus,
  bonusDescription,
  onSurrender,
  surrenderDisabled = false,
  disabled = false,
  bonusEarnSignal = 0,
  zoneId = 1,
  activeMutatorId = 0,
}) => {
  const {
    musicVolume,
    effectsVolume,
    setMusicVolume,
    setEffectsVolume,
    isPlaying,
    playTheme,
    stopTheme,
  } = useMusicPlayer();

  const guardian = useMemo(() => getZoneGuardian(zoneId), [zoneId]);
  const portraitSrc = useMemo(() => getGuardianPortrait(zoneId), [zoneId]);
  const mutator = getMutatorDef(activeMutatorId);

  return (
    <div className="w-full shrink-0">
      {activeBonus !== BonusType.None && bonusDescription && (
        <div className="mb-1 text-center font-sans text-xs font-semibold uppercase tracking-wide text-yellow-300">
          {bonusDescription}
        </div>
      )}
      {/* Action bar with SVG chrome — respect aspect ratio, centered */}
      <div className="relative mx-auto max-w-full">
        <ActionBarSvg />

        {/* Overlay div for interactive elements */}
        <div className="absolute inset-0">
          {/* Surrender — left socket */}
          <Dialog>
            <DialogTrigger
              type="button"
              aria-label="Quit run"
              disabled={surrenderDisabled}
              className="absolute flex items-center justify-center rounded-full border-0 bg-transparent p-0 text-red-400 transition-[color,transform] hover:scale-105 hover:text-red-300 active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40"
              style={circleToPercent(
                ACTION_BAR.sockets.surrender,
                ACTION_BAR.viewBox,
              )}
            >
              <Flag className="h-[40%] w-[40%] drop-shadow-md" />
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold">
                  Quit run?
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Ends this run on-chain with no stars — its accounts settle and
                their rent is reclaimed by the protocol. What you played still
                counts toward your lifetime stats.
              </p>
              <div className="flex gap-3">
                <DialogClose asChild>
                  <Button variant="outline" className="flex-1">
                    Cancel
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={onSurrender}
                    disabled={surrenderDisabled}
                  >
                    Quit run
                  </Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>

          {/* Center socket — bonus (story) or guardian (endless) */}
          <div
            className="absolute flex items-center justify-center"
            style={circleToPercent(
              ACTION_BAR.sockets.bonus,
              ACTION_BAR.viewBox,
            )}
          >
            {bonusSlots.length === 0 ? (
              /* ─── No bonuses: guardian portrait + rules tooltip ─── */
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label={`About ${guardian.name}`}
                    className="h-full w-full cursor-pointer overflow-hidden rounded-full border-0 bg-transparent p-0"
                  >
                    <img
                      src={portraitSrc}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                    />
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="bg-slate-900 border border-slate-500 text-white px-3 py-2 shadow-lg max-w-[200px]"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="font-sans text-xs font-bold">
                        {guardian.name}
                      </div>
                      {activeMutatorId > 0 && (
                        <>
                          <div className="font-sans text-[10px] text-yellow-400/90">
                            {mutator.icon} {mutator.name}: {mutator.description}
                          </div>
                          {getMutatorEffects(mutator, false).length > 0 && (
                            <div className="font-sans text-[10px] font-semibold text-yellow-300">
                              {getMutatorEffects(mutator, false).join(" · ")}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              /* ─── Bonus button(s) — story and endless both show when slots exist ─── */
              bonusSlots.map((slot, idx) => {
                const isSelected = activeBonus === slot.type;
                const hasCharges = slot.charges > 0;

                return (
                  <TooltipProvider
                    key={`${slot.type}-${idx}`}
                    delayDuration={0}
                  >
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        aria-label={`${slot.name}: ${slot.charges} charges`}
                        onClick={
                          hasCharges && !disabled ? slot.onClick : undefined
                        }
                        disabled={!hasCharges || disabled}
                        className={`relative flex h-full w-full cursor-pointer items-center justify-center overflow-visible border-0 bg-transparent p-0 transition-all enabled:hover:scale-[1.08] enabled:active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40 ${
                          isSelected
                            ? "drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                            : ""
                        }`}
                      >
                        {bonusEarnSignal > 0 && (
                          <span
                            key={`earn-ring-${bonusEarnSignal}`}
                            className="bonus-earn-ring pointer-events-none absolute inset-0 rounded-full"
                          />
                        )}
                        <img
                          key={`icon-${bonusEarnSignal}`}
                          src={slot.icon}
                          alt=""
                          className={`h-[60%] w-[60%] object-contain ${
                            bonusEarnSignal > 0 ? "bonus-earn-swirl" : ""
                          }`}
                        />
                        <span
                          key={`badge-${bonusEarnSignal}`}
                          className={`absolute -bottom-1 -right-1 z-10 flex h-[clamp(16px,4vw,26px)] min-w-[clamp(16px,4vw,26px)] items-center justify-center rounded-full px-0.5 font-sans text-[clamp(8px,2vw,14px)] font-bold shadow-[0_0_4px_rgba(0,0,0,0.5)] ${
                            bonusEarnSignal > 0 ? "bonus-badge-pop " : ""
                          }${
                            hasCharges
                              ? "bg-yellow-500 border border-yellow-400/50 text-white"
                              : "bg-slate-700 border border-slate-500 text-slate-400"
                          }`}
                        >
                          {slot.charges}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-slate-900 border border-slate-500 text-white px-3 py-2 shadow-lg max-w-[220px]"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-sans text-xs font-bold">
                            {slot.name}
                          </span>
                          <span className="font-sans text-[11px] text-slate-300">
                            {slot.description}
                          </span>
                          {slot.triggerDescription && (
                            <span className="font-sans text-[10px] text-yellow-400/90 mt-0.5">
                              {slot.triggerDescription}
                            </span>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })
            )}
          </div>

          {/* Settings — right socket */}
          <Dialog>
            <DialogTrigger
              type="button"
              aria-label="Sound settings"
              className="absolute flex items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-400 transition-[color,transform] hover:scale-105 hover:text-slate-200 active:scale-[0.92]"
              style={circleToPercent(
                ACTION_BAR.sockets.settings,
                ACTION_BAR.viewBox,
              )}
            >
              <Settings className="h-[40%] w-[40%] drop-shadow-md" />
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold">
                  Sound Settings
                </DialogTitle>
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
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground">Music</span>
                    <Slider
                      value={[musicVolume]}
                      onValueChange={(value) => setMusicVolume(value[0])}
                      max={1}
                      step={0.05}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground w-8 text-right shrink-0">
                    {Math.round(musicVolume * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 shrink-0" />
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground">
                      Effects
                    </span>
                    <Slider
                      value={[effectsVolume]}
                      onValueChange={(value) => setEffectsVolume(value[0])}
                      max={1}
                      step={0.05}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground w-8 text-right shrink-0">
                    {Math.round(effectsVolume * 100)}%
                  </span>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
};

export default GameActionBar;
