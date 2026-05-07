import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { PublicKey } from "@solana/web3.js";
import { useSolanaGame } from "@/solana/useSolanaGame";
import { useSolanaTournament } from "@/solana/useSolanaTournament";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { getThemeColors, getThemeId, getThemeImages, type ThemeId } from "@/config/themes";
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
const ACTIVE_GAME_PDA_PREFIX = "zkube_game_pda_";
const TOURNAMENT_SUBMIT_RETURN_PREFIX = "zkube_tournament_submit_return_";
const TOURNAMENT_PLAY_REQUEST_PREFIX = "zkube_tournament_play_request_";
const TOURNAMENT_PLAY_CONSUMED_PREFIX = "zkube_tournament_play_consumed_";
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
type TournamentEntryAction = "join" | "rejoin";

function loadActiveGamePda(playerPubkey: string): PublicKey | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_PDA_PREFIX + playerPubkey);
    return raw ? new PublicKey(raw) : null;
  } catch {
    return null;
  }
}

function markTournamentSubmitReturn(playerPubkey: string, tournamentId: number) {
  try {
    sessionStorage.setItem(
      `${TOURNAMENT_SUBMIT_RETURN_PREFIX}${playerPubkey}_${tournamentId}`,
      Date.now().toString(),
    );
  } catch {
    // Best-effort UX guard only.
  }
}

function consumeTournamentPlayRequest(
  playerPubkey: string,
  tournamentId: number,
): TournamentEntryAction | null | false {
  try {
    const requestKey = `${TOURNAMENT_PLAY_REQUEST_PREFIX}${playerPubkey}_${tournamentId}`;
    const consumedKey = `${TOURNAMENT_PLAY_CONSUMED_PREFIX}${playerPubkey}_${tournamentId}`;
    const rawRequest = sessionStorage.getItem(requestKey);
    if (!rawRequest) return false;

    let requestId = rawRequest;
    let tournamentEntryAction: TournamentEntryAction | null = null;
    try {
      const parsed = JSON.parse(rawRequest);
      requestId = String(parsed.id ?? rawRequest);
      tournamentEntryAction =
        parsed.tournamentEntryAction === "join" || parsed.tournamentEntryAction === "rejoin"
          ? parsed.tournamentEntryAction
          : null;
    } catch {
      // Ancien format: la présence de la valeur suffit, sans action tournoi.
    }

    if (sessionStorage.getItem(consumedKey) === requestId) return false;
    sessionStorage.setItem(consumedKey, requestId);
    return tournamentEntryAction;
  } catch {
    return false;
  }
}

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
  const isTournamentMap = useNavigationStore((s) => s.isTournamentMap);
  const tournamentId = useNavigationStore((s) => s.tournamentId);
  const mapZoneId = useNavigationStore((s) => s.mapZoneId);
  const setIsTournamentMap = useNavigationStore((s) => s.setIsTournamentMap);
  const { themeTemplate } = useTheme();
  const playThemeId = useMemo<ThemeId>(
    () => (mapZoneId ? getThemeId(mapZoneId) : (themeTemplate as ThemeId)),
    [mapZoneId, themeTemplate],
  );
  const themeColors = getThemeColors(playThemeId);
  const themeImages = getThemeImages(playThemeId);

  const { select, connect } = useWallet();
  const {
    connected,
    publicKey,
    gameState,
    isLoading,
    error,
    lastTx,
    undelegatingPda,
    isSkipDelegation,
    hasSessionKey,
    createGame,
    makeMove,
    closeGame,
    startNewGame,
    resetGame,
    markLocalGameOver,
    renewSessionKey,
    refresh,
  } = useSolanaGame();

  // ── Tournament score submission ───────────────────────────────────────────
  const { submitTournamentScore } = useSolanaTournament();
  const [tournamentSubmitting, setTournamentSubmitting] = useState(false);
  const [tournamentSubmitted, setTournamentSubmitted] = useState(false);
  const [tournamentSubmitError, setTournamentSubmitError] = useState<string | null>(null);
  const [tournamentSubmitStatus, setTournamentSubmitStatus] = useState<string | null>(null);
  const tournamentAutoStartRef = useRef(false);
  const tournamentGamePdaRef = useRef<PublicKey | null>(null);

  const prevGameKeyRef = useRef<string>("");
  const [gridKey, setGridKey] = useState(0);

  useEffect(() => {
    if (!gameState) { prevGameKeyRef.current = ""; return; }
    const gameKey = `${gameState.player}-${gameState.seed}`;
    if (gameKey !== prevGameKeyRef.current) {
      prevGameKeyRef.current = gameKey;
      setGridKey((k) => k + 1);
      setNextLineHasBeenConsumed(false);
      // Reset tournament submission state for the new game
      setTournamentSubmitted(false);
      setTournamentSubmitError(null);
      setTournamentSubmitStatus(null);
    }
  }, [gameState?.player, gameState?.seed]);

  useEffect(() => {
    if (error) setIsTxProcessing(false);
  }, [error]);

  useEffect(() => {
    if (
      isSkipDelegation ||
      isLoading ||
      !gameState ||
      gameState.delegated ||
      gameState.phase !== "Created" ||
      gameState.seed === "0"
    ) return;

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 1200);
    return () => window.clearInterval(id);
  }, [
    gameState?.delegated,
    gameState?.phase,
    gameState?.seed,
    isLoading,
    isSkipDelegation,
    refresh,
  ]);

  useEffect(() => {
    if (!publicKey) return;
    const activePda = loadActiveGamePda(publicKey);
    if (activePda) tournamentGamePdaRef.current = activePda;
  }, [gameState?.seed, publicKey]);

  useEffect(() => {
    if (!isTournamentMap || tournamentId === null || !connected || !publicKey) {
      tournamentAutoStartRef.current = false;
      return;
    }
    // Ne pas auto-démarrer si on est en train de soumettre le score ou qu'il a déjà été soumis
    if (gameState || isLoading || tournamentAutoStartRef.current || tournamentSubmitting || tournamentSubmitted) return;
    const tournamentEntryAction = consumeTournamentPlayRequest(publicKey, tournamentId);
    if (tournamentEntryAction === false) return;

    tournamentAutoStartRef.current = true;
    void createGame({
      tournamentId,
      tournamentEntryAction: tournamentEntryAction ?? undefined,
    });
  }, [connected, createGame, gameState, isLoading, isTournamentMap, publicKey, tournamentId, tournamentSubmitting, tournamentSubmitted]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState(40);
  const [isTxProcessing, setIsTxProcessing] = useState(false);
  const [nextLineHasBeenConsumed, setNextLineHasBeenConsumed] = useState(false);
  const [gameOverActionsReady, setGameOverActionsReady] = useState(false);

  useEffect(() => {
    if (!gameState?.over) {
      setGameOverActionsReady(false);
      return;
    }
    const timeout = window.setTimeout(() => setGameOverActionsReady(true), 900);
    return () => window.clearTimeout(timeout);
  }, [gameState?.over]);

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

  const handleSubmitTournamentScore = useCallback(async () => {
    if (!publicKey || tournamentId === null || tournamentSubmitting || tournamentSubmitted) return;

    const gameStatePda = loadActiveGamePda(publicKey) ?? tournamentGamePdaRef.current;
    if (!gameStatePda) {
      setTournamentSubmitError("Game account introuvable. Impossible de soumettre le score.");
      return;
    }

    tournamentGamePdaRef.current = gameStatePda;
    setTournamentSubmitting(true);
    setTournamentSubmitError(null);
    setTournamentSubmitStatus("Waiting for final game state…");
    try {
      let finalizedState = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        finalizedState = await refresh();
        if (finalizedState?.over) break;
        await sleep(1000);
      }

      if (!finalizedState?.over) {
        throw new Error("Le score final n'est pas encore confirmé sur l'ER. Réessaie dans quelques secondes.");
      }

      setTournamentSubmitStatus("Closing Ephemeral Rollup game…");
      const closed = await closeGame();
      if (!closed) {
        throw new Error("Impossible de finaliser la partie avant la soumission du score.");
      }

      setTournamentSubmitStatus("Preparing score submission…");
      await submitTournamentScore(tournamentId, gameStatePda, setTournamentSubmitStatus);
      setTournamentSubmitted(true);
      setTournamentSubmitStatus("Score submitted.");
      markTournamentSubmitReturn(publicKey, tournamentId);
      tournamentGamePdaRef.current = null;
      setIsTournamentMap(false);
      navigate("tournament");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTournamentSubmitError(msg);
      setTournamentSubmitStatus(null);
    } finally {
      setTournamentSubmitting(false);
    }
  }, [
    publicKey,
    tournamentId,
    tournamentSubmitting,
    tournamentSubmitted,
    closeGame,
    refresh,
    submitTournamentScore,
    setIsTournamentMap,
    navigate,
  ]);

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
    if (isTournamentMap && tournamentId !== null) {
      if (tournamentSubmitting || tournamentSubmitted || tournamentSubmitError || tournamentGamePdaRef.current) {
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
            <div className="flex w-[min(360px,90vw)] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 p-8 text-center backdrop-blur-sm">
              <p className="text-lg font-bold text-white">
                {tournamentSubmitError ? "Score submission paused" : "Submitting tournament score…"}
              </p>
              <p className="text-sm text-white/50">
                {tournamentSubmitStatus ?? "Finalizing your finished run."}
              </p>
              {tournamentSubmitError && (
                <p className="text-xs text-red-300">{tournamentSubmitError}</p>
              )}
              {tournamentSubmitError && (
                <button
                  onClick={handleSubmitTournamentScore}
                  disabled={tournamentSubmitting}
                  className="rounded-xl bg-purple-600 px-6 py-3 font-bold text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                  Retry Submit
                </button>
              )}
              {tournamentSubmitError && (
                <button
                  onClick={() => navigate("tournament")}
                  className="text-sm text-white/40 transition-colors hover:text-white/70"
                >
                  Back to Tournament
                </button>
              )}
            </div>
          </div>
        );
      }

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
          <div className="flex w-[min(340px,90vw)] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/60 p-8 text-center backdrop-blur-sm">
            <p className="text-lg font-bold text-white">Preparing tournament run…</p>
            <p className="text-sm text-white/50">
              Your entry is confirmed. The game grid will open automatically.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {error && (
              <button
                onClick={() => {
                  tournamentAutoStartRef.current = false;
                  void createGame();
                }}
                className="rounded-xl bg-cyan-600 px-6 py-3 font-bold text-white transition-colors hover:bg-cyan-500"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      );
    }

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
        </div>
      </div>
    );
  }

  // ── Écran : chargement ────────────────────────────────────────────────────
  if (isLoading && !gameState) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center" style={{ backgroundColor: themeColors.primary }}>
        <div className="flex flex-col items-center gap-3 px-8 text-center">
          <p className="text-cyan-400 animate-pulse text-lg font-bold">
            {undelegatingPda ? "Undelegation in progress…" : "Transaction in progress…"}
          </p>
          {undelegatingPda && (
            <p className="text-white/50 text-xs max-w-sm">
              the account is coming back from MagicBlock to Solana. Do not retry New Game until this step is completed.
            </p>
          )}
        </div>
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
        <div className="flex flex-col items-center gap-4 p-8 bg-black/70 rounded-2xl border border-white/10 w-[min(340px,90vw)]">
          <p className="text-3xl font-bold text-red-400">GAME OVER</p>
          <p className="text-white">Score : <span className="text-yellow-400 font-bold text-xl">{gameState.score}</span></p>
          <p className="text-white/60 text-sm">Moves : {gameState.moveCount} · Max combo : {gameState.maxCombo}</p>

          {/* Tournament mode: submit score then go to tournament page */}
          {isTournamentMap && tournamentId !== null ? (
            <>
              {tournamentSubmitting && (
                <p className="text-purple-300 text-sm animate-pulse">
                  {tournamentSubmitStatus ?? "Submitting score to tournament…"}
                </p>
              )}
              {tournamentSubmitted && (
                <p className="text-green-400 text-sm font-bold">Score submitted!</p>
              )}
              {tournamentSubmitError && (
                <p className="text-red-400 text-xs text-center max-w-xs">{tournamentSubmitError}</p>
              )}
              <button
                onClick={handleSubmitTournamentScore}
                disabled={isLoading || tournamentSubmitting}
                className="px-8 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-xl font-bold text-white transition-colors w-full"
              >
                {isLoading || tournamentSubmitting ? "Submitting…" : "Submit Score"}
              </button>
              <button
                onClick={() => {
                  navigate("tournament");
                }}
                disabled={isLoading || tournamentSubmitting}
                className="text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                Back to Tournament
              </button>
            </>
          ) : (
            /* Classic mode */
            <>
              <button
                onClick={() => {
                  if (!gameOverActionsReady) return;
                  startNewGame();
                }}
                disabled={isLoading || !gameOverActionsReady}
                className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-xl font-bold text-white transition-colors"
              >
                {undelegatingPda ? "Preparing…" : isLoading ? "Starting…" : "New Game"}
              </button>
              <button
                onClick={() => navigate("home")}
                className="text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                ← Back to Home
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const isWaitingForDelegation =
    !!gameState &&
    !isSkipDelegation &&
    !gameState.delegated &&
    gameState.phase === "Created" &&
    gameState.seed !== "0";

  if (isWaitingForDelegation) {
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
        <div className="flex w-[min(340px,90vw)] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/60 p-8 text-center backdrop-blur-sm">
          <p className="text-lg font-bold text-white">Preparing Ephemeral Rollup…</p>
          <p className="text-sm text-white/50">
            The grid is ready. Waiting for MagicBlock to expose the delegated state.
          </p>
        </div>
      </div>
    );
  }

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
           Reset &amp; Recommencer
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
        <div className="px-3 py-1.5 bg-yellow-900/60 border-b border-yellow-600/30 text-center">
          <span className="text-yellow-300 text-xs">Generating grid…</span>
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
              onLocalGameOver={markLocalGameOver}
              themeId={playThemeId}
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
              themeId={playThemeId}
            />
          </div>
        </div>
      )}

      {/* Solana tx link */}
      {/* TODO: the tx en bas peut le garder quand c'est mainnnet  */}
      {/* {lastTx && (
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
      )} */}
    </div>
  );
}
