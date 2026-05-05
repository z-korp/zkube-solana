/**
 * useTournaments — Récupère tous les comptes Tournament du programme.
 *
 * Utilise getProgramAccounts avec dataSize = Tournament::SIZE (174 bytes).
 * Ne nécessite pas de wallet connecté — lecture seule.
 * Retourne tournaments triés par tournament_id DESC (le plus récent en premier).
 */

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { IDL } from "@/solana/idl";
import { ZKUBE_PROGRAM_ID } from "@/solana/constants";
import type { TournamentData } from "@/solana/useSolanaTournament";

// Tournament::SIZE = 8 (discriminant) + 4+8+8+1+8+8+4+4+1 + (32+8)*3 = 174 bytes
const TOURNAMENT_ACCOUNT_SIZE = 174;

export type TournamentStatus = "upcoming" | "active" | "ended" | "settled";

export interface TournamentWithStatus extends TournamentData {
  status: TournamentStatus;
}

function getStatus(t: TournamentData): TournamentStatus {
  const now = Math.floor(Date.now() / 1000);
  if (t.settled) return "settled";
  if (now < t.startTime) return "upcoming";
  if (now >= t.startTime && now < t.endTime) return "active";
  return "ended";
}

export function useTournaments() {
  const { connection } = useConnection();
  const [tournaments, setTournaments] = useState<TournamentWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const coder = new BorshAccountsCoder(IDL as any);

        const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [{ dataSize: TOURNAMENT_ACCOUNT_SIZE }],
        });

        const result: TournamentWithStatus[] = [];
        for (const { account } of accounts) {
          try {
            // Anchor 0.32 + IDL v0.1 : BorshAccountsCoder retourne les noms
            // snake_case tels que définis dans l'IDL (pas de conversion camelCase).
            const raw = coder.decode("Tournament", account.data);
            const t: TournamentData = {
              tournamentId:  raw.tournament_id,
              startTime:     Number(raw.start_time),
              endTime:       Number(raw.end_time),
              zoneId:        raw.zone_id,
              entryFee:      BigInt(raw.entry_fee.toString()),
              prizePool:     BigInt(raw.prize_pool.toString()),
              totalPlayers:  raw.total_players,
              totalAttempts: raw.total_attempts,
              settled:       raw.settled,
              winner1:       raw.winner_1,
              prize1:        BigInt(raw.prize_1.toString()),
              winner2:       raw.winner_2,
              prize2:        BigInt(raw.prize_2.toString()),
              winner3:       raw.winner_3,
              prize3:        BigInt(raw.prize_3.toString()),
            };
            result.push({ ...t, status: getStatus(t) });
          } catch (err) {
            console.warn("[useTournaments] decode error:", err);
          }
        }

        // Tri : active en premier, puis upcoming, puis ended/settled — puis par ID DESC
        const statusOrder: Record<TournamentStatus, number> = {
          active: 0, upcoming: 1, ended: 2, settled: 3,
        };
        result.sort((a, b) => {
          const so = statusOrder[a.status] - statusOrder[b.status];
          if (so !== 0) return so;
          return b.tournamentId - a.tournamentId;
        });

        if (!cancelled) setTournaments(result);
      } catch (e) {
        console.error("[useTournaments] fetch error:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetch();
    return () => { cancelled = true; };
  }, [connection]);

  const activeTournaments = tournaments.filter((t) => t.status === "active");
  const upcomingTournaments = tournaments.filter((t) => t.status === "upcoming");
  const recentTournaments = tournaments.filter(
    (t) => t.status === "ended" || t.status === "settled",
  );

  return { tournaments, activeTournaments, upcomingTournaments, recentTournaments, isLoading };
}
