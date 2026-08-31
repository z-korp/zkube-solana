import { Settings } from "lucide-react";

import { useDaily } from "@/backend/client";
import { getZoneGuardian } from "@/config/bossCharacters";
import { dailyThemeName } from "@/core/dailyRules";
import { dailyThemeDescription } from "@/game/constraint";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useNavigationStore } from "@/stores/navigationStore";
import GuardianFaceBlock from "@/ui/components/economy/GuardianFaceBlock";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";

export default function StoreArcadePage() {
  const daily = useDaily();
  const active = useActiveDailyAttempt();
  const navigate = useNavigationStore((state) => state.navigate);
  const openSettings = useNavigationStore((state) => state.openSettings);
  const view = daily.daily;
  const realm = view?.mapId ?? 1;
  const guardian = getZoneGuardian(realm);
  const enter = async () => {
    const run = await daily.enter();
    navigate("play", run.runId);
  };

  return (
    <div className="relative flex min-h-full flex-col px-4 pb-6 pt-7 text-white">
      <ZoneBackdrop zoneId={realm} />
      <header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center">
        <span />
        <h1 className="font-display text-[36px] leading-none text-[#FFF4D7]">
          Arcade
        </h1>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Open settings"
          className="ml-auto grid h-9 w-9 place-items-center rounded-xl bg-black/45 text-white/75"
        >
          <Settings size={17} />
        </button>
      </header>

      <section className="relative z-10 mt-6 rounded-3xl border border-white/10 bg-[#101a2b]/95 p-5 text-center shadow-2xl">
        <GuardianFaceBlock zoneId={realm} size={104} className="mx-auto" />
        <p className="mt-3 font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
          Daily challenge
        </p>
        <h2 className="font-display text-3xl text-white">{guardian.name}</h2>
        {view && (
          <>
            <p className="mt-2 font-sans text-sm font-black text-cyan-200">
              {dailyThemeName(view.dailyTheme)}
            </p>
            <p className="mt-1 font-sans text-xs leading-5 text-white/60">
              {dailyThemeDescription(view.dailyTheme)}
            </p>
          </>
        )}
        <button
          type="button"
          disabled={!view || daily.action !== null}
          onClick={() => {
            if (active) navigate("play", active.gameId);
            else void enter();
          }}
          className="mt-5 w-full rounded-2xl bg-amber-300 px-4 py-3 font-sans text-sm font-black text-slate-950 disabled:opacity-40"
        >
          {active ? "Resume run" : daily.action ? "Opening…" : "Play today"}
        </button>
      </section>
    </div>
  );
}
