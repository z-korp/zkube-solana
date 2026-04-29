/**
 * usePlayerEntry — lit la DailyEntry d'un joueur pour un challenge donné.
 */

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { IDL } from "@/solana/idl";
import { getDailyEntryPda } from "@/solana/dailyConstants";

export interface DailyEntryData {
  challenge_id: number;
  player: string;
  score: number;
  /** total_stars = min(score / 100, 30) — calculé côté client */
  totalStars: number;
  completed: boolean;
  /** Rank calculé côté leaderboard — non disponible on-chain pour l'instant */
  rank?: number;
  /** star_reward — récompense en étoiles selon le rang (non implémenté on-chain) */
  star_reward?: number;
}

export function usePlayerEntry(challengeId: number | undefined, playerAddress: string | undefined) {
  const { connection } = useConnection();
  const [entry, setEntry] = useState<DailyEntryData | null>(null);

  const fetchEntry = useCallback(async () => {
    if (!challengeId || !playerAddress) {
      setEntry(null);
      return;
    }
    try {
      let playerPubkey: PublicKey;
      try {
        playerPubkey = new PublicKey(playerAddress);
      } catch {
        setEntry(null);
        return;
      }

      const dummyWallet = {
        publicKey: Keypair.generate().publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, {
        commitment: "confirmed",
      });
      const program = new Program(IDL as any, provider);
      const pda = getDailyEntryPda(challengeId, playerPubkey);

      try {
        const raw = await (program.account as any).dailyEntry.fetch(pda);
        const score: number = raw.score;
        const totalStars = Math.min(Math.floor(score / 100), 30);
        setEntry({
          challenge_id: raw.challengeId,
          player: raw.player.toBase58(),
          score,
          totalStars,
          completed: raw.completed,
          rank: undefined,
          star_reward: undefined,
        });
      } catch {
        setEntry(null);
      }
    } catch (err) {
      console.error("[usePlayerEntry] fetch error:", err);
      setEntry(null);
    }
  }, [connection, challengeId, playerAddress]);

  useEffect(() => {
    fetchEntry();
    const id = setInterval(fetchEntry, 30_000);
    return () => clearInterval(id);
  }, [fetchEntry]);

  return {
    entry,
    isRegistered: entry !== null,
  };
}

export default usePlayerEntry;
