import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Eye } from "lucide-react";
import { PublicKey } from "@solana/web3.js";

import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { toDisplayGrid } from "@/chain/gridProjection";
import type { SpectateTarget } from "@/chain/spectateRun";
import { useSpectatedRun } from "@/chain/useSpectatedRun";
import { useNavigationStore } from "@/stores/navigationStore";
import NextLine from "@/ui/components/NextLine";
import SpectatorGrid from "@/ui/components/SpectatorGrid";
import SpectatorHud from "@/ui/components/hud/SpectatorHud";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const ROWS = 10;
const COLS = 8;

export default function SpectatorScreen() {
  const navigate = useNavigationStore((state) => state.navigate);
  const rawTarget = useNavigationStore((state) => state.spectateTarget);

  const parsed = useMemo<{
    target: SpectateTarget | null;
    error: string | null;
  }>(() => {
    if (!rawTarget) return { target: null, error: null };
    try {
      const target: SpectateTarget = {};
      if (rawTarget.pda) target.pda = new PublicKey(rawTarget.pda);
      if (rawTarget.player) target.player = new PublicKey(rawTarget.player);
      if (rawTarget.runId !== undefined && rawTarget.runId !== null) {
        target.runId = BigInt(rawTarget.runId);
      }
      if (!target.pda && !target.player) {
        return { target: null, error: "No spectate target provided." };
      }
      return { target, error: null };
    } catch {
      return { target: null, error: "Invalid player or run address." };
    }
  }, [rawTarget]);

  const { run, status } = useSpectatedRun(parsed.target);

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

  const live = run && (run.phase === "delegated" || run.phase === "base");
  const activeRun = live ? run.activeRun : null;
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
            {run?.phase === "delegated"
              ? "Live · Rollup"
              : run?.phase === "base"
                ? "Live · Base"
                : run?.phase === "settled"
                  ? "Settled"
                  : "Spectating"}
          </span>
          <span className="font-mono text-white/40">{watchedLabel}</span>
          {status?.phase === "reconnecting" && (
            <span className="text-amber-300">reconnecting…</span>
          )}
        </div>

        {parsed.error && (
          <Panel>
            <h2 className="text-xl font-black text-red-300">Cannot spectate</h2>
            <p className="text-center text-sm text-white/60">{parsed.error}</p>
            <BackButton onClick={() => navigate("ranks")} />
          </Panel>
        )}

        {!parsed.error && run?.phase === "not-found" && (
          <Panel>
            <h2 className="text-xl font-black">No run found</h2>
            <p className="text-center text-sm text-white/60">
              This player has no current run on-chain. Finalized results appear
              on the leaderboard.
            </p>
            <BackButton onClick={() => navigate("ranks")} />
          </Panel>
        )}

        {!parsed.error && !run && !status?.error && (
          <Panel>
            <p className="animate-pulse text-lg font-bold text-cyan-300">
              Resolving run…
            </p>
          </Panel>
        )}

        {run?.phase === "settled" && (
          <Panel>
            <h2 className="text-2xl font-black text-yellow-300">
              {run.receipt.completed ? "Run completed" : "Run finished"}
            </h2>
            <div className="grid w-full grid-cols-3 gap-2 text-center">
              <Metric label="Score" value={run.receipt.score} />
              <Metric label="Moves" value={run.receipt.moves} />
              <Metric
                label={run.receipt.mode === "daily" ? "Mode" : "Stars"}
                value={
                  run.receipt.mode === "daily"
                    ? "Daily"
                    : `${run.receipt.levelStars}★`
                }
              />
            </div>
            <BackButton onClick={() => navigate("ranks")} />
          </Panel>
        )}

        {activeRun && (
          <>
            <SpectatorHud run={activeRun} onBack={() => navigate("ranks")} />
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

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-3">
      <strong className="block text-lg text-cyan-200">{value}</strong>
      <span className="text-[8px] uppercase tracking-widest text-white/40">
        {label}
      </span>
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
