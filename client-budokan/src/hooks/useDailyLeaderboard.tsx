/**
 * useDailyLeaderboard — charge toutes les DailyEntry pour un challenge
 * en utilisant getProgramAccounts avec un filtre sur challenge_id,
 * puis les trie par score décroissant pour former le classement.
 */

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "@/solana/constants";

export interface DailyLeaderboardEntry {
  player: string;
  score: number;
  totalStars: number;
  rank: number;
  completed: boolean;
  playerName?: string;
  // Champ compat Cairo — non utilisé sur Solana
  level?: number;
}

export function useDailyLeaderboard(challengeId: number | undefined) {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<DailyLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    if (!challengeId) {
      setEntries([]);
      return;
    }
    setIsLoading(true);
    try {
      // Discriminant du compte DailyEntry = [95, 72, 107, 127, 200, 191, 88, 121]
      const DAILY_ENTRY_DISC = Buffer.from([95, 72, 107, 127, 200, 191, 88, 121]);

      // Filtre par discriminant (offset 0) et challenge_id (offset 8, u32 LE)
      const challengeIdBuf = Buffer.alloc(4);
      challengeIdBuf.writeUInt32LE(challengeId, 0);

      const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: DAILY_ENTRY_DISC.toString("base64") } },
          { memcmp: { offset: 8, bytes: challengeIdBuf.toString("base64") } },
        ],
        dataSlice: undefined, // on veut les données complètes
      });

      // Décoder manuellement (offset dans le buffer Anchor) :
      // [0..8]   = discriminant
      // [8..12]  = challenge_id (u32 LE)
      // [12..44] = player (Pubkey 32 bytes)
      // [44..48] = score (u32 LE)
      // [48]     = completed (bool)
      const raw: Array<{ player: string; score: number; completed: boolean }> = accounts
        .map(({ account }) => {
          const data = account.data;
          if (data.length < 49) return null;
          const player = new PublicKey(data.slice(12, 44)).toBase58();
          const score = data.readUInt32LE(44);
          const completed = data[48] === 1;
          return { player, score, completed };
        })
        .filter(Boolean) as Array<{ player: string; score: number; completed: boolean }>;

      // Trier par score décroissant et attribuer les rangs
      raw.sort((a, b) => b.score - a.score);
      const ranked: DailyLeaderboardEntry[] = raw.map((e, i) => ({
        player: e.player,
        score: e.score,
        totalStars: Math.min(Math.floor(e.score / 100), 30),
        rank: i + 1,
        completed: e.completed,
        playerName: undefined,
      }));

      setEntries(ranked);
    } catch (err) {
      console.error("[useDailyLeaderboard] fetch error:", err);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection, challengeId]);

  useEffect(() => {
    fetchLeaderboard();
    const id = setInterval(fetchLeaderboard, 30_000);
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  return { entries, isLoading };
}

export default useDailyLeaderboard;
