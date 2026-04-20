import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl";
import {
  ZKUBE_PROGRAM_ID,
  VRF_PROGRAM_ID,
  ORACLE_QUEUE,
  getGameStatePda,
  getIdentityPda,
} from "./constants";

// État de la partie côté frontend
export interface SolanaGameState {
  player: string;
  blocks: number[];   // 80 valeurs (grille 10x8)
  nextRow: number[];  // 8 valeurs
  score: number;
  comboCounter: number;
  maxCombo: number;
  moveCount: number;
  seed: string;       // u64 en string (BigInt)
  over: boolean;
}

export function useSolanaGame() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;

  const [gameState, setGameState] = useState<SolanaGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  // Crée le provider Anchor à partir du wallet connecté
  const getProgram = useCallback(() => {
    if (!publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [connection, wallet, publicKey]);

  // Récupère l'état de la partie depuis la blockchain
  const fetchGameState = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    try {
      const pda = getGameStatePda(publicKey);
      const gs = await (program.account as any).gameState.fetchNullable(pda);
      if (gs) {
        setGameState({
          player: gs.player.toBase58(),
          blocks: Array.from(gs.blocks as number[]),
          nextRow: Array.from(gs.nextRow as number[]),
          score: gs.score,
          comboCounter: gs.comboCounter,
          maxCombo: gs.maxCombo,
          moveCount: gs.moveCount,
          seed: gs.seed.toString(),
          over: gs.over,
        });
      } else {
        setGameState(null);
      }
    } catch (e) {
      console.error("[useSolanaGame] fetchGameState error:", e);
    }
  }, [publicKey, getProgram]);

  // Rafraîchit l'état quand le wallet est connecté
  useEffect(() => {
    if (connected && publicKey) {
      fetchGameState();
    } else {
      setGameState(null);
    }
  }, [connected, publicKey, fetchGameState]);

  // Crée une nouvelle partie
  const createGame = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda = getGameStatePda(publicKey);
      const identityPda = getIdentityPda();

      const tx = await (program.methods as any)
        .createGame()
        .accounts({
          player: publicKey,
          gameState: gameStatePda,
          oracleQueue: ORACLE_QUEUE,
          identity: identityPda,
          vrfProgram: VRF_PROGRAM_ID,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTx(tx);
      console.log("[Solana] create_game tx:", tx);
      await fetchGameState();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de la création de partie");
      console.error("[useSolanaGame] createGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram, fetchGameState]);

  // Joue un coup
  const makeMove = useCallback(
    async (rowIndex: number, startIndex: number, finalIndex: number) => {
      if (!publicKey) return;
      const program = getProgram();
      if (!program) return;

      setIsLoading(true);
      setError(null);
      try {
        const gameStatePda = getGameStatePda(publicKey);

        const tx = await (program.methods as any)
          .makeMove(rowIndex, startIndex, finalIndex)
          .accounts({ player: publicKey, gameState: gameStatePda })
          .rpc();

        setLastTx(tx);
        console.log("[Solana] make_move tx:", tx);
        await fetchGameState();
      } catch (e: any) {
        setError(e?.message ?? "Erreur lors du coup");
        console.error("[useSolanaGame] makeMove error:", e);
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey, getProgram, fetchGameState]
  );

  // Ferme la partie
  const closeGame = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda = getGameStatePda(publicKey);

      const tx = await (program.methods as any)
        .closeGame()
        .accounts({ player: publicKey, gameState: gameStatePda })
        .rpc();

      setLastTx(tx);
      console.log("[Solana] close_game tx:", tx);
      setGameState(null);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de la fermeture");
      console.error("[useSolanaGame] closeGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram]);

  return {
    // État
    connected,
    publicKey: publicKey?.toBase58() ?? null,
    gameState,
    isLoading,
    error,
    lastTx,
    // Actions
    createGame,
    makeMove,
    closeGame,
    refresh: fetchGameState,
  };
}
