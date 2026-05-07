/**
 * SpectatorScreen — watch a bot game read-only via ?pda=<gameStatePda>
 * No wallet required. Reads state from Solana devnet every 2 seconds.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { BonusType } from "@/dojo/game/types/bonusTypes";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import Grid from "@/ui/components/Grid";
import NextLine from "@/ui/components/NextLine";
import { getThemeColors, getThemeImages } from "@/config/themes";
import type { ThemeId } from "@/config/themes";
import { SOLANA_ENDPOINT, ZKUBE_PROGRAM_ID } from "@/solana/constants";
import "../../grid.css";

const THEME: ThemeId = "theme-1";
const ROWS = 10;
const COLS = 8;
const REFRESH_MS = 1_000;

// ── Account deserialization (same layout as Hydra ZKubeStateService) ──────────
const OFFSETS = {
  blocks: 40,    // [u8; 80]
  nextRow: 120,  // [u8; 8]
  score: 128,    // u32 LE
  maxCombo: 133, // u8
  moveCount: 134,// u32 LE
  seed: 138,     // u64 LE
  over: 146,     // bool
  phase: 180,    // u8 enum
};
const PHASES = ["Created", "Delegated", "Playing", "Finished"];

interface BotGameState {
  blocks: number[];
  nextRow: number[];
  score: number;
  moveCount: number;
  maxCombo: number;
  phase: string;
  over: boolean;
  seed: string;
}

function parseAccount(data: Uint8Array): BotGameState | null {
  try {
    if (data.length < 213) return null;
    const buf = Buffer.from(data);
    const blocks   = Array.from(buf.subarray(OFFSETS.blocks,   OFFSETS.blocks   + 80));
    const nextRow  = Array.from(buf.subarray(OFFSETS.nextRow,  OFFSETS.nextRow  + 8));
    const score    = buf.readUInt32LE(OFFSETS.score);
    const maxCombo = buf.readUInt8(OFFSETS.maxCombo);
    const moveCount= buf.readUInt32LE(OFFSETS.moveCount);
    const lo       = BigInt(buf.readUInt32LE(OFFSETS.seed));
    const hi       = BigInt(buf.readUInt32LE(OFFSETS.seed + 4));
    const seed     = String((hi << 32n) | lo);
    const over     = buf.readUInt8(OFFSETS.over) !== 0;
    const phase    = PHASES[buf.readUInt8(OFFSETS.phase)] ?? "Unknown";
    return { blocks, nextRow, score, moveCount, maxCombo, phase, over, seed };
  } catch {
    return null;
  }
}

function solanaBlocksToGrid(blocks: number[]): number[][] {
  const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let i = 0; i < blocks.length; i++) {
    grid[ROWS - 1 - Math.floor(i / COLS)][i % COLS] = blocks[i];
  }
  return grid;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SpectatorScreen({ pda }: { pda: string }) {
  const [state, setState]     = useState<BotGameState | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [gridSize, setGridSize] = useState(40);
  const [gridKey, setGridKey] = useState(0);
  const prevSeedRef           = useRef("");
  const areaRef               = useRef<HTMLDivElement>(null);
  const themeColors           = getThemeColors(THEME);
  const themeImages           = getThemeImages(THEME);
  const connection            = new Connection(SOLANA_ENDPOINT, "confirmed");

  const fetchState = useCallback(async () => {
    try {
      const info = await connection.getAccountInfo(new PublicKey(pda));
      if (!info) { setError("Game not found on-chain."); return; }
      if (!info.owner.equals(ZKUBE_PROGRAM_ID)) { setError("Not a zkube account."); return; }
      const parsed = parseAccount(info.data);
      if (!parsed) { setError("Failed to parse game account."); return; }
      setError(null);
      if (parsed.seed !== prevSeedRef.current && prevSeedRef.current !== "") {
        setGridKey((k) => k + 1); // new game → reset grid animation
      }
      prevSeedRef.current = parsed.seed;
      setState(parsed);
    } catch (e) {
      setError(String(e));
    }
  }, [pda]);

  useEffect(() => {
    void fetchState();
    const id = window.setInterval(() => void fetchState(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchState]);

  // Responsive grid sizing
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      const byW = Math.floor((w - 24) / COLS);
      const byH = Math.floor((h - 40) / (ROWS + 1));
      setGridSize(Math.max(28, Math.min(Math.min(byW, byH), 72)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initialData  = state ? transformDataContractIntoBlock(solanaBlocksToGrid(state.blocks)) : [];
  const nextLineData = state ? transformDataContractIntoBlock([state.nextRow]) : [];
  const stateKey = state
    ? `${state.seed}-${state.moveCount}-${state.score}-${state.blocks.join("")}-${state.nextRow.join("")}`
    : "loading";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        backgroundImage: `url(${themeImages.gameBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: themeColors.primary,
      }}
    >
      {/* la nav bar en haut avec les score et tout  */}

      <div className="flex items-center justify-between px-4 py-2 bg-black/30">
        <div className="text-xs text-white/50 font-mono">
          zKube Live · {pda.slice(0, 6)}…{pda.slice(-4)}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-yellow-400 font-bold text-lg leading-none">{state?.score ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Score</div>
          </div>
          <div className="text-center">
            <div className="text-cyan-400 font-bold text-lg leading-none">{state?.moveCount ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Moves</div>
          </div>
          <div className="text-center">
            <div className="text-purple-400 font-bold text-lg leading-none">{state?.maxCombo ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Combo</div>
          </div>
          <div className={`text-xs font-bold px-2 py-1 rounded ${
            state?.over
              ? "bg-red-900/60 text-red-300"
              : state?.phase === "Playing" || state?.phase === "Created"
              ? "bg-green-900/60 text-green-300"
              : "bg-white/10 text-white/40"
          }`}>
            {state?.over ? "GAME OVER" : (state?.phase ?? "…")}
          </div>
        </div>
        <div className="text-[10px] text-white/20">on-chain · 1s</div>
      </div>

      {/* Banners */}
      {error && (
        <div className="px-4 py-1.5 bg-red-900/50 text-red-300 text-xs text-center border-b border-red-800/30">
          {error}
        </div>
      )}
      {!state && !error && (
        <div className="px-4 py-1.5 text-white/40 text-xs text-center animate-pulse">
          Loading game state…
        </div>
      )}
      {state?.seed === "0" && (
        <div className="px-4 py-1 bg-yellow-900/50 text-yellow-300 text-xs text-center border-b border-yellow-700/30">
          Waiting for VRF oracle to initialize the grid…
        </div>
      )}

      {/* Grid area */}
      <div
        ref={areaRef}
        className="relative flex flex-1 min-h-0 flex-col items-center justify-center p-2 md:p-3 select-none cursor-default"
      >
        {state && state.seed !== "0" && (
          <div className="flex min-h-0 flex-1 flex-col items-center">
            <div className="pointer-events-none">
              <Grid
                key={`${gridKey}-${stateKey}`}
                gameId={0n}
                initialData={initialData}
                nextLineData={nextLineData}
                setNextLineHasBeenConsumed={() => {}}
                gridSize={gridSize}
                gridHeight={ROWS}
                gridWidth={COLS}
                bonus={BonusType.None}
                account={null}
                isTxProcessing={false}
                setIsTxProcessing={() => {}}
                levelTransitionPending={false}
                onLocalGameOver={() => {}}
                themeId={THEME}
              />
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 py-0.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Next Row</span>
            </div>
            <NextLine
              nextLineData={nextLineData}
              gridSize={gridSize}
              gridHeight={1}
              gridWidth={COLS}
              themeId={THEME}
            />
          </div>
        )}
      </div>
    </div>
  );
}
