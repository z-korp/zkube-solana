import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useSolanaGame } from "@/solana/useSolanaGame";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { getThemeColors, getThemeImages, type ThemeId } from "@/config/themes";
import { BonusType } from "@/dojo/game/types/bonusTypes";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import Grid from "@/ui/components/Grid";
import NextLine from "@/ui/components/NextLine";
import { ChevronUp } from "lucide-react";
import "../../grid.css";

const ROWS = 10;
const COLS = 8;
const NEXT_LINE_ROWS = 1;
const HORIZONTAL_PADDING = 24;
const VERTICAL_CHROME = 36;

/** Convert Solana flat blocks array (80 values) to number[][] (10 rows × 8 cols)
 *  Solana row 0 = bottom of grid → display at y = ROWS-1 (bottom)
 *  Solana row 9 = top of grid   → display at y = 0 (top)
 */
function solanaBlocksToGrid(blocks: number[]): number[][] {
  const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let i = 0; i < blocks.length; i++) {
    const solanaRow = Math.floor(i / COLS);
    const col = i % COLS;
    // Invert: Solana row 0 → display row ROWS-1 (bottom)
    grid[ROWS - 1 - solanaRow][col] = blocks[i];
  }
  return grid;
}

export default function SolanaPlayScreen() {
  const navigate = useNavigationStore((s) => s.navigate);
  const { themeTemplate } = useTheme();
  const themeColors = getThemeColors(themeTemplate as ThemeId);
  const themeImages = getThemeImages(themeTemplate as ThemeId);

  // Phantom wallet
  const { connect, select } = useWallet();
  const {
    connected,
    publicKey,
    gameState,
    isLoading,
    error,
    lastTx,
    createGame,
    makeMove,
    closeGame,
  } = useSolanaGame();

  // Re-key grid uniquement pour un NOUVEAU jeu (seed ou joueur différent)
  const prevGameKeyRef = useRef<string>("");
  const [gridKey, setGridKey] = useState(0);

  useEffect(() => {
    if (!gameState) {
      prevGameKeyRef.current = "";
      return;
    }
    const gameKey = `${gameState.player}-${gameState.seed}`;
    if (gameKey !== prevGameKeyRef.current) {
      prevGameKeyRef.current = gameKey;
      setGridKey((k) => k + 1);
      setNextLineHasBeenConsumed(false);
    }
  }, [gameState?.player, gameState?.seed]);

  // Reset isTxProcessing si une erreur Solana survient (TX échouée)
  useEffect(() => {
    if (error) setIsTxProcessing(false);
  }, [error]);

  // Grid sizing (same logic as GameBoard)
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState(40);
  const [isTxProcessing, setIsTxProcessing] = useState(false);
  const [nextLineHasBeenConsumed, setNextLineHasBeenConsumed] = useState(false);

  // Responsive grid sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      const safeWidth = Math.max(1, w - HORIZONTAL_PADDING);
      const safeHeight = Math.max(1, h - VERTICAL_CHROME);
      const cellByWidth = Math.floor(safeWidth / COLS);
      const cellByHeight = Math.floor(safeHeight / (ROWS + NEXT_LINE_ROWS));
      const cellSize = Math.min(cellByWidth, cellByHeight);
      setGridSize(Math.max(28, Math.min(cellSize, 72)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Convert Solana state → Block[]
  const initialData = useMemo(() => {
    if (!gameState) return [];
    return transformDataContractIntoBlock(solanaBlocksToGrid(gameState.blocks));
  }, [gameState, gridKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextLineData = useMemo(() => {
    if (!gameState) return [];
    return transformDataContractIntoBlock([gameState.nextRow]);
  }, [gameState, gridKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Solana move handler passed to Grid
  // Handler de move : retourne le nouvel état blockchain pour que Grid
  // l'injecte dans pendingReceiptRef (même mécanisme que les events Dojo).
  // isTxProcessing est géré par Grid (CASCADE_COMPLETE → applyReceipt).
  const handleMove = useCallback(
    async (rowIndex: number, startIndex: number, finalIndex: number) => {
      const result = await makeMove(rowIndex, startIndex, finalIndex);
      if (result) {
        return {
          blocks: solanaBlocksToGrid(result.rawBlocks),
          nextRow: result.nextRow,
          over: result.over,
        };
      }
    },
    [makeMove],
  );

  const handleConnectPhantom = async () => {
    select("Phantom" as WalletName<"Phantom">);
    await connect();
  };

  if (!connected) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-6"
        style={{
          backgroundImage: `url(${themeImages.gameBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: themeColors.primary,
        }}
      >
        <button
          onClick={() => navigate("home")}
          className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/50 rounded-2xl border border-white/10 backdrop-blur-sm">
          <p className="text-white/70 text-sm">Connect your Phantom wallet to play on Solana</p>
          <button
            onClick={handleConnectPhantom}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold text-white text-lg transition-colors flex items-center gap-2"
          >
            🔮 Connect Phantom
          </button>
        </div>
      </div>
    );
  }

  // ─── Connected, no game 
  if (!gameState && !isLoading) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-6"
        style={{
          backgroundImage: `url(${themeImages.gameBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: themeColors.primary,
        }}
      >
        <button
          onClick={() => navigate("home")}
          className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/50 rounded-2xl border border-white/10 backdrop-blur-sm">
          <p className="text-xs text-white/50 font-mono">
            {publicKey?.slice(0, 8)}...{publicKey?.slice(-6)}
          </p>
          {error && <p className="text-red-400 text-sm">⚠️ {error}</p>}
          <button
            onClick={createGame}
            disabled={isLoading}
            className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-xl font-bold text-white text-lg transition-colors"
          >
            🎮 New Solana Game
          </button>
        </div>
      </div>
    );
  }

  // ─── Loading 
  if (isLoading && !gameState) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center"
        style={{ backgroundColor: themeColors.primary }}
      >
        <p className="text-cyan-400 animate-pulse text-lg font-bold">Transaction en cours...</p>
      </div>
    );
  }

  // ─── Game over 
  if (gameState?.over) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-6"
        style={{
          backgroundImage: `url(${themeImages.gameBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: themeColors.primary,
        }}
      >
        <div className="flex flex-col items-center gap-4 p-8 bg-black/70 rounded-2xl border border-white/10">
          <p className="text-3xl font-bold text-red-400">GAME OVER</p>
          <p className="text-white">Score : <span className="text-yellow-400 font-bold text-xl">{gameState.score}</span></p>
          <p className="text-white/60 text-sm">Coups : {gameState.moveCount} · Combo max : {gameState.maxCombo}</p>
          <button
            onClick={closeGame}
            disabled={isLoading}
            className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-xl font-bold text-white transition-colors"
          >
            New Game
          </button>
        </div>
      </div>
    );
  }

  // ─── Game created but VRF oracle hasn't responded yet ────────────────────
  if (gameState && gameState.seed === "0") {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-4"
        style={{ backgroundColor: themeColors.primary }}
      >
        <p className="text-cyan-400 animate-pulse text-lg font-bold">Génération de la grille…</p>
        <p className="text-white/50 text-sm">L'oracle VRF initialise votre partie</p>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Active game ──────────────────────────────────────────────────────────
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
      {/* HUD */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/30">
        <button
          onClick={() => navigate("home")}
          className="text-white/60 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-yellow-400 font-bold text-lg leading-none">{gameState?.score ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Score</div>
          </div>
          <div className="text-center">
            <div className="text-cyan-400 font-bold text-lg leading-none">{gameState?.moveCount ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Moves</div>
          </div>
          <div className="text-center">
            <div className="text-purple-400 font-bold text-lg leading-none">{gameState?.maxCombo ?? 0}</div>
            <div className="text-white/50 text-[10px] uppercase tracking-wider">Combo</div>
          </div>
        </div>
        <div className="text-[10px] text-purple-300 font-mono">
          🔮 {publicKey?.slice(0, 6)}…
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1 bg-red-900/70 text-red-300 text-xs text-center">
          {error}
        </div>
      )}

      {/* Grid area */}
      {gameState && (
        <div
          ref={containerRef}
          className={`relative flex flex-1 min-h-0 flex-col p-2 md:p-3 ${isTxProcessing ? "cursor-wait" : ""}`}
        >
          <div className={`flex min-h-0 flex-1 flex-col items-center ${!isTxProcessing ? "cursor-move" : ""}`}>
            <Grid
              key={gridKey}
              gameId={0n}
              initialData={initialData}
              nextLineData={nextLineData}
              setNextLineHasBeenConsumed={setNextLineHasBeenConsumed}
              gridSize={gridSize}
              gridHeight={ROWS}
              gridWidth={COLS}
              bonus={BonusType.None}
              account={null}
              isTxProcessing={isTxProcessing}
              setIsTxProcessing={setIsTxProcessing}
              levelTransitionPending={false}
              onMove={handleMove}
            />
            <div className="mt-1 flex items-center justify-center gap-1 py-0.5">
              <div className="chevron-pulse">
                <ChevronUp size={14} className="text-white/50" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Next Row
              </span>
            </div>
            <NextLine
              nextLineData={nextLineHasBeenConsumed ? [] : nextLineData}
              gridSize={gridSize}
              gridHeight={1}
              gridWidth={COLS}
            />
          </div>
        </div>
      )}

      {/* Solana tx link */}
      {lastTx && (
        <div className="text-center pb-2">
          <a
            href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-cyan-500 hover:text-cyan-400 underline"
          >
            Last tx: {lastTx.slice(0, 10)}… ↗
          </a>
        </div>
      )}
    </div>
  );
}
