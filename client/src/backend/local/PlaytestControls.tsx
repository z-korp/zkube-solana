import { useEffect, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";

import { ZONE_NAMES } from "@/config/profileData";
import { dailyThemeName } from "@/core/dailyRules";
import { DAILY_THEMES } from "@/core/dailyRules.generated";
import {
  playtestSettings,
  randomizePlaytestSeed,
  subscribePlaytestSettings,
  updatePlaytestSettings,
} from "./playtest";

export function PlaytestSeedControl() {
  const settings = usePlaytestSettings();
  const [draft, setDraft] = useState(settings.seedHex);

  useEffect(() => setDraft(settings.seedHex), [settings.seedHex]);

  const commit = () => {
    if (/^[0-9a-f]{64}$/i.test(draft)) {
      updatePlaytestSettings({ seedHex: draft });
    } else {
      setDraft(settings.seedHex);
    }
  };

  return (
    <div className="rounded-xl border border-cyan-300/20 bg-cyan-950/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/60">
          Row seed
        </label>
        <button
          type="button"
          onClick={() => randomizePlaytestSeed()}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-2 py-1 font-sans text-[10px] font-bold text-cyan-50"
        >
          <RefreshCw size={11} />
          New rows
        </button>
      </div>
      <input
        aria-label="Row seed"
        value={draft}
        onChange={(event) => setDraft(event.target.value.trim())}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        spellCheck={false}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-1 font-mono text-[9px] text-cyan-50/75 outline-none focus:border-cyan-300/45"
      />
    </div>
  );
}

export function PlaytestDailyControls() {
  const settings = usePlaytestSettings();
  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-[#0c2030]/95 p-3">
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/60">
        Owner play build
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="font-sans text-[10px] font-semibold text-white/55">
          Realm
          <select
            aria-label="Daily realm"
            value={settings.realm}
            onChange={(event) =>
              updatePlaytestSettings({ realm: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map(
              (realm) => (
                <option key={realm} value={realm}>
                  {realm}. {ZONE_NAMES[realm] ?? `Realm ${realm}`}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="font-sans text-[10px] font-semibold text-white/55">
          Objective
          <select
            aria-label="Daily objective"
            value={settings.objectiveIndex}
            onChange={(event) =>
              updatePlaytestSettings({
                objectiveIndex: Number(event.target.value),
              })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
          >
            {DAILY_THEMES.map((objective, index) => (
              <option
                key={`${objective.kind}:${objective.value}`}
                value={index}
              >
                {dailyThemeName(objective)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2">
        <PlaytestSeedControl />
      </div>
    </section>
  );
}

function usePlaytestSettings() {
  return useSyncExternalStore(
    subscribePlaytestSettings,
    playtestSettings,
    playtestSettings,
  );
}
