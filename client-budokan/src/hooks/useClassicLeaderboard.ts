import { useCallback, useEffect, useState } from "react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { IDL } from "@/solana/idl";
import { ZKUBE_PROGRAM_ID } from "@/solana/constants";

const GAME_STATE_SIZE = 213;
const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error("Read-only wallet cannot sign transactions");
  },
  signAllTransactions: async () => {
    throw new Error("Read-only wallet cannot sign transactions");
  },
};

export interface ClassicLeaderboardEntry {
  player: string;
  score: number;
  rank: number;
  moveCount: number;
  maxCombo: number;
  playerName?: string;
}

function createReadOnlyProgram(connection: any) {
  const provider = new AnchorProvider(connection, READONLY_WALLET as any, {
    commitment: "confirmed",
  });
  return new Program(IDL as any, provider);
}

export function useClassicLeaderboard() {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<ClassicLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    try {
      const program = createReadOnlyProgram(connection);
      const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ dataSize: GAME_STATE_SIZE }],
      });

      const bestByPlayer = new Map<string, Omit<ClassicLeaderboardEntry, "rank">>();
      for (const { account } of accounts) {
        try {
          const raw = program.coder.accounts.decode("GameState", account.data);
          const player = raw.player.toBase58();
          const score = Number(raw.score);
          const moveCount = Number(raw.moveCount ?? raw.move_count ?? 0);
          const maxCombo = Number(raw.maxCombo ?? raw.max_combo ?? 0);
          const phase = raw.phase ? Object.keys(raw.phase)[0]?.toLowerCase() : "";
          const finished = Boolean(raw.over) || phase === "finished";

          if (!finished || score <= 0) continue;

          const prev = bestByPlayer.get(player);
          if (
            !prev ||
            score > prev.score ||
            (score === prev.score && moveCount > 0 && moveCount < prev.moveCount)
          ) {
            bestByPlayer.set(player, { player, score, moveCount, maxCombo });
          }
        } catch {
          // Ignore accounts that are not GameState-compatible.
        }
      }

      const ranked = Array.from(bestByPlayer.values())
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.moveCount - b.moveCount;
        })
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      setEntries(ranked);
    } catch (err) {
      console.error("[useClassicLeaderboard] fetch error:", err);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void fetchLeaderboard();
    const id = window.setInterval(fetchLeaderboard, 30_000);
    return () => window.clearInterval(id);
  }, [fetchLeaderboard]);

  return { entries, isLoading, refetch: fetchLeaderboard };
}

export default useClassicLeaderboard;
