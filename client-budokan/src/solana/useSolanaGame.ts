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
  getTreasuryPda,
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
  // TODO: a supprimer quand l'oracle vrf fonctionne
  // Polling continu tant que la grille est vide (seed == 0 = oracle VRF pas encore répondu)
  // S'arrête automatiquement quand les blocs sont remplis
  useEffect(() => {
    if (!gameState || gameState.seed !== "0") return;
    // Seed est 0 → oracle n'a pas encore répondu, on poll toutes les 2s
    const interval = setInterval(() => {
      fetchGameState();
    }, 2000);
    return () => clearInterval(interval);
  }, [gameState?.seed, fetchGameState]);

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
      const treasuryPda = getTreasuryPda();

      const tx = await (program.methods as any)
        .createGame()
        .accounts({
          player: publicKey,
          gameState: gameStatePda,
          oracleQueue: ORACLE_QUEUE,
          identity: identityPda,
          vrfProgram: VRF_PROGRAM_ID,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTx(tx);
      console.log("[Solana] create_game tx:", tx);

      // Poll until VRF oracle populates the blocks (seed != 0)
      let attempts = 0;
      let gs = null;
      while (attempts < 10) {
        await new Promise((r) => setTimeout(r, 1500));
        gs = await fetchGameState();
        const state = await (async () => {
          const pda = getGameStatePda(publicKey);
          return await (program.account as any).gameState.fetchNullable(pda);
        })();
        if (state && state.blocks.some((b: number) => b > 0)) break;
        attempts++;
      }
      await fetchGameState();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      // "already processed" = Phantom a resoumis la TX qui avait déjà réussi
      // "already in use"   = la PDA existe encore (close non encore GC'd)
      if (msg.includes("already been processed") || msg.includes("already in use")) {
        // La partie a peut-être été créée quand même — on resync
        try {
          const pda = getGameStatePda(publicKey!);
          const gs = await (program.account as any).gameState.fetchNullable(pda);
          if (gs) {
            await fetchGameState();
            return; // État valide récupéré, pas d'erreur à afficher
          }
        } catch (_) {}
      }
      setError(msg || "Erreur lors de la création de partie");
      console.error("[useSolanaGame] createGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram, fetchGameState]);

  // Joue un coup — retourne le nouvel état brut pour que Grid puisse se resynchroniser
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

        // Fetch once — met à jour le state React ET retourne les données brutes
        const gs = await (program.account as any).gameState.fetchNullable(gameStatePda);
        if (gs) {
          const newState: SolanaGameState = {
            player: gs.player.toBase58(),
            blocks: Array.from(gs.blocks as number[]),
            nextRow: Array.from(gs.nextRow as number[]),
            score: gs.score,
            comboCounter: gs.comboCounter,
            maxCombo: gs.maxCombo,
            moveCount: gs.moveCount,
            seed: gs.seed.toString(),
            over: gs.over,
          };
          setGameState(newState);
          // Retourné à handleMove pour injection dans pendingReceiptRef du Grid
          return {
            rawBlocks: newState.blocks,
            nextRow: newState.nextRow,
            over: newState.over,
          };
        }
      } catch (e: any) {
        const msg: string = e?.message ?? "";
        // "already been processed" = Phantom a resoumis une TX qui avait déjà réussi
        // Le move a quand même été appliqué on-chain → fetch et retourne l'état sans erreur
        if (msg.includes("already been processed")) {
          try {
            const program2 = getProgram();
            if (program2) {
              const gameStatePda = getGameStatePda(publicKey!);
              const gs = await (program2.account as any).gameState.fetchNullable(gameStatePda);
              if (gs) {
                const newState: SolanaGameState = {
                  player: gs.player.toBase58(),
                  blocks: Array.from(gs.blocks as number[]),
                  nextRow: Array.from(gs.nextRow as number[]),
                  score: gs.score,
                  comboCounter: gs.comboCounter,
                  maxCombo: gs.maxCombo,
                  moveCount: gs.moveCount,
                  seed: gs.seed.toString(),
                  over: gs.over,
                };
                setGameState(newState);
                return { rawBlocks: newState.blocks, nextRow: newState.nextRow, over: newState.over };
              }
            }
          } catch (_) {}
          // Si le fetch échoue aussi, on sort sans afficher d'erreur
          return;
        }
        setError(msg || "Erreur lors du coup");
        console.error("[useSolanaGame] makeMove error:", e);
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey, getProgram]
  );

  // receiveRandomness supprimé : l'oracle VRF MagicBlock répond correctement.
  // L'appel manuel depuis le frontend était un contournement de sécurité (devnet).
  // Sur mainnet, seul l'oracle peut appeler receive_randomness (VRF proof).

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
      const msg: string = e?.message ?? "";
      
      if (msg.includes("already been processed")) {
        try {
          const pda = getGameStatePda(publicKey!);
          const program2 = getProgram();
          if (program2) {
            const gs = await (program2.account as any).gameState.fetchNullable(pda);
            if (!gs) {
              setGameState(null); // Fermé avec succès
              return;
            }
          }
        } catch (_) {}
      }
      setError(msg || "Erreur lors de la fermeture");
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
