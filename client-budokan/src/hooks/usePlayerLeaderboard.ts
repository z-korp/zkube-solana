import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { ZKUBE_PROGRAM_ID } from "@/solana/constants";

const TOURNAMENT_ENTRY_SIZE = 58;
const TOURNAMENT_ENTRY_DISC = Buffer.from([36, 203, 172, 114, 100, 189, 217, 158]);

export interface PlayerLeaderboardEntry {
  player: string;
  score: number;
  bestScore: number;
  lifetimeXp: number;
  rank: number;
  attempts: number;
  submittedAt: number;
  tournamentId: number;
  playerName?: string;
}

function decodeTournamentEntry(data: Buffer): Omit<PlayerLeaderboardEntry, "rank"> | null {
  if (data.length < TOURNAMENT_ENTRY_SIZE) return null;
  if (!data.subarray(0, 8).equals(TOURNAMENT_ENTRY_DISC)) return null;

  const tournamentId = data.readUInt32LE(8);
  const player = new PublicKey(data.subarray(12, 44)).toBase58();
  const bestScore = data.readUInt32LE(44);
  const submittedAt = Number(data.readBigInt64LE(48));
  const attempts = data[56] ?? 0;
  const hasSubmitted = data[57] === 1;

  if (!hasSubmitted || bestScore <= 0) return null;

  return {
    player,
    score: bestScore,
    bestScore,
    lifetimeXp: bestScore,
    attempts,
    submittedAt,
    tournamentId,
  };
}

export function usePlayerLeaderboard(tournamentId: number | null) {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<PlayerLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    // Pas de tournoi connu → on n'essaie pas de fetcher
    if (tournamentId === null) {
      setEntries([]);
      return;
    }
    setIsLoading(true);
    try {
      const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ dataSize: TOURNAMENT_ENTRY_SIZE }],
      });

      const rawEntries = accounts
        .map(({ account }) => decodeTournamentEntry(account.data))
        .filter((entry): entry is Omit<PlayerLeaderboardEntry, "rank"> =>
          !!entry && entry.tournamentId === tournamentId,
        );

      const ranked = rawEntries
        .sort((a, b) => {
          if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
          return a.submittedAt - b.submittedAt;
        })
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      setEntries(ranked);
    } catch (err) {
      console.error("[usePlayerLeaderboard] fetch error:", err);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection, tournamentId]);

  useEffect(() => {
    void fetchLeaderboard();
    const id = window.setInterval(fetchLeaderboard, 30_000);
    return () => window.clearInterval(id);
  }, [fetchLeaderboard]);

  return { entries, isLoading, refetch: fetchLeaderboard };
}

export default usePlayerLeaderboard;
