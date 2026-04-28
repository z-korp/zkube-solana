import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useSolanaGame } from "@/solana/useSolanaGame";
import { useNavigationStore } from "@/stores/navigationStore";

// Couleurs par taille de bloc (1-4)
const BLOCK_COLORS: Record<number, string> = {
  0: "bg-gray-900",
  1: "bg-cyan-500",
  2: "bg-purple-500",
  3: "bg-orange-500",
  4: "bg-pink-500",
};

// Rendu de la grille 10x8
function SolanaGrid({ blocks }: { blocks: number[] }) {
  return (
    <div className="flex flex-col-reverse gap-0.5 p-2 bg-gray-900 rounded-lg border border-gray-700">
      {Array.from({ length: 10 }, (_, row) => (
        <div key={row} className="flex gap-0.5">
          {Array.from({ length: 8 }, (_, col) => {
            const value = blocks[row * 8 + col] ?? 0;
            return (
              <div
                key={col}
                className={`w-8 h-8 rounded-sm flex items-center justify-center text-xs font-bold text-white
                  ${BLOCK_COLORS[value] ?? "bg-gray-900"}
                  ${value > 0 ? "opacity-90" : "opacity-20"}`}
              >
                {value > 0 ? value : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function SolanaPage() {
  const { connect, disconnect, select } = useWallet();
  const navigate = useNavigationStore((s) => s.navigate);
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
    refresh,
  } = useSolanaGame();

  const handleConnectPhantom = async () => {
    select("Phantom" as WalletName<"Phantom">);
    await connect();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 flex flex-col items-center gap-6">

      {/* Header */}
      <div className="w-full max-w-md flex items-center gap-3">
        <button
          onClick={() => navigate("home")}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="flex-1 flex flex-col items-center gap-1">
          <h1 className="text-3xl font-bold tracking-wider text-cyan-400">
            zKube × Solana
          </h1>
          <p className="text-gray-400 text-sm">Devnet</p>
        </div>
      </div>

      {/* Wallet */}
      <div className="w-full max-w-md bg-gray-900 rounded-xl p-4 border border-gray-700">
        {!connected ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-gray-400 text-sm">Connecte ton wallet Phantom pour jouer</p>
            <button
              onClick={handleConnectPhantom}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold transition-colors flex items-center gap-2"
            >
              🔮 Connecter Phantom
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Connecté</p>
              <p className="text-sm font-mono text-cyan-400">
                {publicKey?.slice(0, 8)}...{publicKey?.slice(-6)}
              </p>
            </div>
            <button
              onClick={() => disconnect()}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Déconnecter
            </button>
          </div>
        )}
      </div>

      {/* Erreur */}
      {error && (
        <div className="w-full max-w-md bg-red-900/50 border border-red-500 rounded-lg p-3 text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Pas encore de partie */}
      {connected && !gameState && !isLoading && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-400">Aucune partie en cours</p>
          <button
            onClick={createGame}
            className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-bold text-lg transition-colors"
          >
            🎮 Nouvelle partie
          </button>
        </div>
      )}

      {/* Chargement */}
      {isLoading && (
        <div className="text-cyan-400 animate-pulse">Transaction en cours...</div>
      )}

      {/* Partie active */}
      {connected && gameState && (
        <div className="flex flex-col items-center gap-4 w-full max-w-2xl">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 w-full">
            <div className="bg-gray-900 rounded-lg p-3 text-center border border-gray-700">
              <div className="text-2xl font-bold text-yellow-400">{gameState.score}</div>
              <div className="text-xs text-gray-400 mt-1">Score</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 text-center border border-gray-700">
              <div className="text-2xl font-bold text-cyan-400">{gameState.moveCount}</div>
              <div className="text-xs text-gray-400 mt-1">Coups</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 text-center border border-gray-700">
              <div className="text-2xl font-bold text-purple-400">{gameState.maxCombo}</div>
              <div className="text-xs text-gray-400 mt-1">Combo max</div>
            </div>
          </div>

          {/* Game Over */}
          {gameState.over && (
            <div className="w-full bg-red-900/30 border border-red-500 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400 mb-2">GAME OVER</div>
              <div className="text-gray-300">Score final : <span className="text-yellow-400 font-bold">{gameState.score}</span></div>
              <button
                onClick={closeGame}
                disabled={isLoading}
                className="mt-4 px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-bold transition-colors disabled:opacity-50"
              >
                Nouvelle partie
              </button>
            </div>
          )}

          {/* Grille */}
          {!gameState.over && (
            <>
              <SolanaGrid blocks={gameState.blocks} />

              {/* Contrôles */}
              <div className="flex flex-col gap-3 w-full">
                <p className="text-xs text-gray-400 text-center">
                  Jouer un coup (ligne, colonne départ → colonne arrivée)
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {[
                    { label: "← Ligne 0", row: 0, start: 4, end: 0 },
                    { label: "→ Ligne 0", row: 0, start: 0, end: 4 },
                    { label: "← Ligne 1", row: 1, start: 4, end: 0 },
                    { label: "→ Ligne 1", row: 1, start: 0, end: 4 },
                  ].map((move) => (
                    <button
                      key={move.label}
                      onClick={() => makeMove(move.row, move.start, move.end)}
                      disabled={isLoading}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {move.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 flex-wrap justify-center">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              🔄 Rafraîchir
            </button>
            <button
              onClick={closeGame}
              disabled={isLoading}
              className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              🗑️ Fermer la partie
            </button>
          </div>

          {/* Dernière tx */}
          {lastTx && (
            <a
              href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-500 hover:text-cyan-400 underline transition-colors"
            >
              Dernière tx : {lastTx.slice(0, 12)}... (Explorer ↗)
            </a>
          )}
        </div>
      )}
    </div>
  );
}
