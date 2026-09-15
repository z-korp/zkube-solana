import { useRef } from "react";
import { Music2, Volume2 } from "lucide-react";

import { useMusicPlayer } from "@/contexts/hooks";
import { mixHex } from "@/ui/components/economy/tokens";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

export const AUDIO_ON_LEVEL = 0.7;

export default function AudioSettingsControls() {
  const accent = useThemeColors().accent;
  const { musicVolume, effectsVolume, setMusicVolume, setEffectsVolume } =
    useMusicPlayer();
  const lastMusic = useRef(AUDIO_ON_LEVEL);
  const lastEffects = useRef(AUDIO_ON_LEVEL);
  const keyStyle: React.CSSProperties = {
    background: `linear-gradient(160deg, ${mixHex(accent, 255, 0.42)} 0%, ${accent} 55%, ${mixHex(accent, 0, 0.28)} 100%)`,
    boxShadow: `0 3px 0 ${mixHex(accent, 0, 0.55)}, inset 0 1.5px 0 rgba(255,255,255,0.5)`,
    color: "#0a1628",
  };

  return (
    <section>
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
        Audio
      </p>
      <div className="mt-2 flex flex-col gap-2.5">
        {(
          [
            ["Music", Music2, musicVolume, setMusicVolume, lastMusic],
            ["Effects", Volume2, effectsVolume, setEffectsVolume, lastEffects],
          ] as const
        ).map(([label, Icon, value, onChange, last]) => {
          const on = value > 0;
          return (
            <div key={label} className="flex items-center gap-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Toggle ${label.toLowerCase()}`}
                onClick={() => {
                  if (on) {
                    last.current = value;
                    onChange(0);
                  } else {
                    onChange(last.current || AUDIO_ON_LEVEL);
                  }
                }}
                className="grid h-10 w-10 flex-none place-items-center rounded-xl"
                style={
                  on
                    ? keyStyle
                    : {
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.45)",
                      }
                }
              >
                <Icon size={17} />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                aria-label={`${label} volume`}
                value={Math.round(value * 100)}
                onChange={(event) => {
                  const next = Number(event.target.value) / 100;
                  if (next > 0) last.current = next;
                  onChange(next);
                }}
                className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full border border-white/[0.08]"
                style={{
                  accentColor: accent,
                  background: `linear-gradient(90deg, ${mixHex(accent, 0, 0.25)} 0%, ${accent} ${Math.round(value * 100)}%, rgba(255,255,255,0.16) ${Math.round(value * 100)}%)`,
                }}
              />
              <span
                className="w-9 flex-none text-right font-mono text-[13px] font-bold tabular-nums"
                style={{ color: accent }}
              >
                {Math.round(value * 100)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
