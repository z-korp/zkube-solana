/**
 * useCurrentChallenge — lit le DailyChallenge du jour depuis Solana.
 *
 * Retourne :
 *   challenge   — données du challenge actuel (null si absent ou en cours de chargement)
 *   isLoading   — true pendant le fetch initial
 *   challengeId — challenge_id calculé côté client (= Math.floor(Date.now() / 86400000))
 */

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { IDL } from "@/solana/idl";
import { getDailyChallengePda, getTodayChallengeId } from "@/solana/dailyConstants";

export interface DailyChallenge {
  challenge_id: number;
  start_time: number;
  end_time: number;
  zone_id: number;
  active_mutator_id: number;
  passive_mutator_id: number;
  total_entries: number;
  settled: boolean;
}

export function useCurrentChallenge() {
  const { connection } = useConnection();
  const [challenge, setChallenge] = useState<DailyChallenge | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  const challengeId = getTodayChallengeId();

  const fetchChallenge = useCallback(async () => {
    setIsLoading(true);
    try {
      // On crée un provider en lecture seule avec un keypair factice
      const dummyWallet = {
        publicKey: Keypair.generate().publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, {
        commitment: "confirmed",
      });
      const program = new Program(IDL as any, provider);

      const pda = getDailyChallengePda(challengeId);

      try {
        const raw = await (program.account as any).dailyChallenge.fetch(pda);
        const dc: DailyChallenge = {
          challenge_id: raw.challengeId,
          start_time: Number(raw.startTime),
          end_time: Number(raw.endTime),
          zone_id: raw.zoneId,
          active_mutator_id: raw.activeMutatorId,
          passive_mutator_id: raw.passiveMutatorId,
          total_entries: raw.totalEntries,
          settled: raw.settled,
        };
        setChallenge(dc);
      } catch {
        // Compte absent — le challenge n'a pas encore été créé
        setChallenge(undefined);
      }
    } catch (err) {
      console.error("[useCurrentChallenge] fetch error:", err);
      setChallenge(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [connection, challengeId]);

  useEffect(() => {
    fetchChallenge();
    // Rafraîchir toutes les 60 secondes
    const id = setInterval(fetchChallenge, 60_000);
    return () => clearInterval(id);
  }, [fetchChallenge]);

  return { challenge, isLoading, challengeId };
}

export default useCurrentChallenge;
