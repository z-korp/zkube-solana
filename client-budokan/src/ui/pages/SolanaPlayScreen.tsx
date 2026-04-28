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

function solanaBlocksToGrid(blocks: number[]): number[][] {
  const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let i = 0; i < blocks.length; i++) {
    const solanaRow = Math.floor(i / COLS);
    const col = i % COLS;
    grid[ROWS - 1 - solanaRow][col] = blocks[i];
  }
  return grid;
}

export default function SolanaPlayScreen() {
  const navigate = useNavigationStore((s) => s.navigate);
  const { themeTemplate } = useTheme();
  const themeColors = getThemeColors(themeTemplate as ThemeId);
  const themeImages = getThemeImages(themeTemplate as ThemeId);

  const { select, connect } = useWallet();
  const {
    connected,
    publicKey,
    gameState,
    isLoading,
    error,
    lastTx,
    hasSessionKey,
    createGame,
    makeMove,
    closeGame,
    resetGame,
    renewSessionKey,
  } = useSolanaGame();

  const prevGameKeyRef = useRef<string>("");
  const [gridKey, setGridKey] = useState(0);

  useEffect(() => {
    if (!gameState) { prevGameKeyRef.current = ""; return; }
    const gameKey = `${gameState.player}-${gameState.seed}`;
    if (gameKey !== prevGameKeyRef.current) {
      prevGameKeyRef.current = gameKey;
      setGridKey((k) => k + 1);
      setNextLineHasBeenConsumed(false);
    }
  }, [gameState?.player, gameState?.seed]);

  useEffect(() => {
    if (error) setIsTxProcessing(false);
  }, [error]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState(40);
  const [isTxProcessing, setIsTxProcessing] = useState(false);
  const [nextLineHasBeenConsumed, setNextLineHasBeenConsumed] = useState(false);

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
      setGridSize(Math.max(28, Math.min(Math.min(cellByWidth, cellByHeight), 72)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const initialData = useMemo(() => {
    if (!gameState) return [];
    return transformDataContractIntoBlock(solanaBlocksToGrid(gameState.blocks));
  }, [gameState, gridKey]); // eslint-disable-line

  const nextLineData = useMemo(() => {
    if (!gameState) return [];
    return transformDataContractIntoBlock([gameState.nextRow]);
  }, [gameState, gridKey]); // eslint-disable-line

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

  // ── Connexion Phantom ─────────────────────────────────────────────────────
  // select() déclenche une mise à jour d'état React asynchrone.
  // Appeler connect() immédiatement après provoque WalletNotSelectedError
  // car le wallet n'est pas encore enregistré dans le contexte.
  // Solution : select() uniquement ici, le useEffect ci-dessous appelle connect()
  // une fois que wallet.adapter.name === "Phantom" est propagé.
  const handleConnectPhantom = useCallback(() => {
    select("Phantom" as WalletName<"Phantom">);
  }, [select]);

  // Tente une connexion automatique dès que Phantom est sélectionné
  const { wallet, connecting } = useWallet();
  useEffect(() => {
    if (wallet?.adapter.name === "Phantom" && !connected && !connecting) {
      connect().catch(() => {});
    }
  }, [wallet?.adapter.name, connected, connecting, connect]);

  // ── Écran : non connecté ──────────────────────────────────────────────────
  if (!connected || !publicKey) {
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
        <button onClick={() => navigate("home")} className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors">
          ← Back
        </button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/50 rounded-2xl border border-white/10 backdrop-blur-sm">
          <p className="text-white/70 text-sm">Connect your Phantom wallet to play on Solana</p>
          <button
            onClick={handleConnectPhantom}
            disabled={connecting}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-xl font-bold text-white text-lg transition-colors flex items-center gap-2"
          >
            {connecting ? "Connecting…" : "Connect Phantom"}
          </button>
        </div>
      </div>
    );
  }

  // ── Écran : pas de partie (ou compte corrompu) ────────────────────────────
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
        <button onClick={() => navigate("home")} className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors">
          ← Back
        </button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/50 rounded-2xl border border-white/10 backdrop-blur-sm">
          <p className="text-xs text-white/50 font-mono">
            {publicKey?.slice(0, 8)}...{publicKey?.slice(-6)}
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={createGame}
            disabled={isLoading}
            className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-xl font-bold text-white text-lg transition-colors"
          >
            New Game
          </button>
          {/* Reset toujours disponible — nettoie un ancien compte bloqué */}
          <button
            onClick={resetGame}
            disabled={isLoading}
            className="px-4 py-2 text-sm text-yellow-400/70 hover:text-yellow-300 border border-yellow-500/30 hover:border-yellow-400/50 rounded-lg transition-colors disabled:opacity-40"
          >
            🔄 Reset Account
          </button>
          <p className="text-white/30 text-xs text-center max-w-xs">
            Use Reset if New Game fails (old account format)
          </p>
        </div>
      </div>
    );
  }

  // ── Écran : chargement ────────────────────────────────────────────────────
  if (isLoading && !gameState) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center" style={{ backgroundColor: themeColors.primary }}>
        <p className="text-cyan-400 animate-pulse text-lg font-bold">Transaction en cours…</p>
      </div>
    );
  }

  // ── Écran : game over ─────────────────────────────────────────────────────
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
            {isLoading ? "Committing…" : "New Game"}
          </button>
        </div>
      </div>
    );
  }

  // ── Écran : compte bloqué (non délégué, quelle que soit la phase) ──────────
  // En mode SKIP_DELEGATION, le jeu tourne sur devnet sans délégation → delegated=false
  // est l'état normal. On n'affiche "Compte bloqué" que si la partie est Finished
  // (besoin de reset) ou si le seed est 0 alors que la phase n'est pas Created (incohérent).
  // Exception : isLoading=true pendant createGame() (flux normal create→delegate).
  const isSkipDelegation = true; // doit correspondre à SKIP_DELEGATION dans useSolanaGame
  // En bypass, la phase passe Created → Playing au 1er move (make_move.rs ligne 66).
  // Les deux phases sont jouables. On bloque uniquement sur Finished (besoin de reset).
  const isPlayableBypass =
    isSkipDelegation &&
    gameState?.seed !== "0" &&
    gameState?.phase !== "Finished";
  if (gameState && !gameState.delegated && !isLoading && !isPlayableBypass) {
    const phaseLabel = gameState.phase === "Created"
      ? "La délégation vers l'Ephemeral Rollup a échoué."
      : gameState.phase === "Finished"
      ? "La partie est terminée — réinitialise pour en commencer une nouvelle."
      : "Compte dans un état incohérent (ancien format ou délégation échouée).";
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6" style={{ backgroundColor: themeColors.primary }}>
        <button onClick={() => navigate("home")} className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors">← Back</button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/70 rounded-2xl border border-yellow-500/30">
          <p className="text-yellow-400 font-bold text-lg">Compte bloqué</p>
          <p className="text-white/60 text-sm text-center max-w-xs">
            {phaseLabel}<br/>
            <span className="text-white/40 text-xs">Phase : {gameState.phase} · Délégué : non</span>
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={resetGame}
            disabled={isLoading}
            className="px-8 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 rounded-xl font-bold text-white transition-colors"
          >
            🔄 Reset &amp; Recommencer
          </button>
        </div>
      </div>
    );
  }

  // ── Écran : session key manquante (reconnexion mid-game) ──────────────────
  // Le jeu est délégué sur l'ER mais la session_key n'est plus en mémoire.
  // En bypass mode, le jeu n'est jamais délégué → cette condition ne s'active jamais.
  if (gameState?.delegated && !hasSessionKey && !isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6" style={{ backgroundColor: themeColors.primary }}>
        <button onClick={() => navigate("home")} className="absolute top-4 left-4 text-white/60 hover:text-white text-sm transition-colors">← Back</button>
        <div className="flex flex-col items-center gap-4 p-8 bg-black/70 rounded-2xl border border-purple-500/30">
          <p className="text-purple-300 font-bold text-lg">Session expirée</p>
          <p className="text-white/60 text-sm text-center max-w-xs">
            Ta clé de session a été perdue (fermeture d'onglet).<br/>
            Autorise une nouvelle clé pour reprendre sans popup.
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={renewSessionKey}
            disabled={isLoading}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-xl font-bold text-white transition-colors"
          >
            Renouveler la session (1 popup)
          </button>
          <button
            onClick={closeGame}
            disabled={isLoading}
            className="px-4 py-2 text-sm text-red-400/70 hover:text-red-300 border border-red-400/30 rounded-lg transition-colors disabled:opacity-40"
          >
            Quitter la partie
          </button>
        </div>
      </div>
    );
  }

  // ── Écran : jeu actif ─────────────────────────────────────────────────────
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
        <button onClick={() => navigate("home")} className="text-white/60 hover:text-white text-sm transition-colors">
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
        <button
          onClick={closeGame}
          disabled={isLoading}
          className="text-[10px] text-red-400/70 hover:text-red-300 disabled:opacity-40 transition-colors font-mono border border-red-400/30 hover:border-red-300/50 rounded px-2 py-1"
          title="Fermer la partie"
        >
          ✕ Close
        </button>
      </div>

      {/* Banner VRF en attente */}
      {gameState?.seed === "0" && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-yellow-900/60 border-b border-yellow-600/30">
          <span className="text-yellow-300 text-xs">⏳ VRF en attente</span>
          <button onClick={closeGame} disabled={isLoading} className="text-xs text-yellow-200 hover:text-white bg-yellow-700/60 hover:bg-yellow-600/80 disabled:opacity-40 rounded px-3 py-0.5 transition-colors font-bold">
            Fermer &amp; Recommencer
          </button>
        </div>
      )}

      {/* Banner session key active (feedback visuel) */}
      {hasSessionKey && (
        <div className="px-3 py-1 bg-green-900/40 border-b border-green-600/20 text-center">
          <span className="text-green-400 text-[10px]">⚡ Session active — moves gratuits</span>
        </div>
      )}

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
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Next Row</span>
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
