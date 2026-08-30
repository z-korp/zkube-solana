import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Eye } from "lucide-react";

import { useSpectatedRun } from "@/backend/client";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { toDisplayGrid } from "@/game/model";
import { useNavigationStore } from "@/stores/navigationStore";
import NextLine from "@/ui/components/NextLine";
import SpectatorGrid from "@/ui/components/SpectatorGrid";
import SpectatorHud from "@/ui/components/hud/SpectatorHud";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const ROWS = 10;
const COLS = 8;

// PARKED 2026-08-29 — owner ruling; not reachable from the product until unparked
export default function SpectatorScreen() {
  const navigate = useNavigationStore((state) => state.navigate);
  const rawTarget = useNavigationStore((state) => state.spectateTarget);

  const parsed = useMemo(() => ({
    address: rawTarget?.player ?? "",
    error: rawTarget?.player
      ? null
      : "A player address is required to spectate.",
  }), [rawTarget]);

  const { run, error: watchError, loading } = useSpectatedRun(
    parsed.address,
    "arcade",
  );

  // Board sizing (spectator layout mirrors the play screen)
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardHeight, setBoardHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const node = boardRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBoardHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const gridSize = Math.max(
    20,
    Math.min(52, Math.floor((boardHeight - 90) / 11)),
  );

  const activeRun = run;
  const themeId = getThemeId(activeRun?.mapId ?? 1);
  const colors = getThemeColors(themeId);
  const images = getThemeImages(themeId);
  const grid = useMemo(
    () => (activeRun ? toDisplayGrid(activeRun.grid) : []),
    [activeRun],
  );
  const nextRow = useMemo(
    () =>
      activeRun?.nextRow
        ? transformDataContractIntoBlock([activeRun.nextRow])
        : [],
    [activeRun],
  );

  const watchedLabel = rawTarget?.player
    ? truncatePublicKey(rawTarget.player)
    : rawTarget?.pda
      ? truncatePublicKey(rawTarget.pda)
      : "—";

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col text-white"
      style={{
        backgroundImage: `url(${images.background})`,
        backgroundColor: colors.background,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="flex h-full min-h-0 w-full flex-col bg-black/25">
        {/* Status strip */}
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
          <Eye size={12} />
          <span>
            {activeRun ? "Live" : "Spectating"}
          </span>
          <span className="font-mono text-white/40">{watchedLabel}</span>
          {loading && <span className="text-amber-300">resolving…</span>}
        </div>

        {parsed.error && (
          <Panel>
            <h2 className="text-xl font-black text-red-300">Cannot spectate</h2>
            <p className="text-center text-sm text-white/60">{parsed.error}</p>
            <BackButton onClick={() => navigate("arcade")} />
          </Panel>
        )}

        {!parsed.error && !loading && !activeRun && !watchError && (
          <Panel>
            <h2 className="text-xl font-black">No run found</h2>
            <p className="text-center text-sm text-white/60">
              This player has no current run on-chain. Finalized results appear
              on the leaderboard.
            </p>
            <BackButton onClick={() => navigate("arcade")} />
          </Panel>
        )}

        {!parsed.error && loading && (
          <Panel>
            <p className="animate-pulse text-lg font-bold text-cyan-300">
              Resolving run…
            </p>
          </Panel>
        )}

        {!parsed.error && watchError && (
          <Panel>
            <h2 className="text-xl font-black text-red-300">Cannot spectate</h2>
            <p className="text-center text-sm text-white/60">{watchError}</p>
            <BackButton onClick={() => navigate("arcade")} />
          </Panel>
        )}

        {activeRun && (
          <>
            <SpectatorHud run={activeRun} onBack={() => navigate("arcade")} />
            <div
              ref={boardRef}
              className="flex min-h-0 flex-1 flex-col items-center justify-center p-2"
            >
              <SpectatorGrid
                grid={grid}
                gridSize={gridSize}
                gridWidth={COLS}
                gridHeight={ROWS}
                themeId={themeId}
              />
              <div className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
                <ChevronUp size={14} /> Next row
                {(activeRun.lifecycle === "awaitingVrf" ||
                  activeRun.pendingVrfCounter > 0) && (
                  <span className="ml-2 animate-pulse text-cyan-300">
                    Rolling next row…
                  </span>
                )}
              </div>
              <NextLine
                nextLineData={nextRow}
                gridSize={gridSize}
                gridHeight={1}
                gridWidth={COLS}
                themeId={themeId}
              />
              {(activeRun.lifecycle === "levelComplete" ||
                activeRun.lifecycle === "finished") && (
                <p className="mt-2 rounded-full border border-yellow-300/30 bg-yellow-950/60 px-4 py-1 text-xs font-bold text-yellow-200">
                  {activeRun.lifecycle === "levelComplete"
                    ? "Level complete — awaiting settlement"
                    : "Run finished — awaiting settlement"}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="flex w-[min(390px,92vw)] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 p-8 backdrop-blur-md">
        {children}
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl bg-cyan-600 px-7 py-3 font-bold text-white"
    >
      To leaderboard
    </button>
  );
}
