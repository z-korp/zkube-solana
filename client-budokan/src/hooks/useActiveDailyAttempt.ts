/**
 * useActiveDailyAttempt — lit l'ActiveDailyAttempt du joueur connecté.
 *
 * Retourne null si le joueur n'a pas de tentative active,
 * ou un objet { challengeId, startedAt } si une tentative est en cours.
 */

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { IDL } from "@/solana/idl";
import { getActiveDailyPda } from "@/solana/dailyConstants";

export interface ActiveDailyRun {
  /** challenge_id de la tentative en cours */
  challengeId: number;
  /** timestamp de démarrage (secondes Unix) */
  startedAt: number;
  // gameId n'existe pas sur Solana — le game PDA est toujours ["game", player]
  // conservé pour compatibilité avec le code Cairo / navigation
  gameId: bigint;
  level: number;
  isReplay: boolean;
}

export const useActiveDailyAttempt = (): ActiveDailyRun | null => {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [active, setActive] = useState<ActiveDailyRun | null>(null);

  const fetchActive = useCallback(async () => {
    if (!publicKey || !connected) {
      setActive(null);
      return;
    }
    try {
      const dummyWallet = {
        publicKey: Keypair.generate().publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, {
        commitment: "confirmed",
      });
      const program = new Program(IDL as any, provider);
      const pda = getActiveDailyPda(publicKey);

      try {
        const raw = await (program.account as any).activeDailyAttempt.fetch(pda);
        setActive({
          challengeId: raw.challengeId,
          startedAt: Number(raw.startedAt),
          // Compat champs Cairo — non utilisés dans le flow Solana
          gameId: BigInt(0),
          level: 0,
          isReplay: false,
        });
      } catch {
        // Compte absent — pas de tentative active
        setActive(null);
      }
    } catch (err) {
      console.error("[useActiveDailyAttempt] fetch error:", err);
      setActive(null);
    }
  }, [connection, publicKey, connected]);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  return active;
};

export default useActiveDailyAttempt;
