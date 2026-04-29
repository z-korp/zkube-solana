/**
 * useSolanaDaily — actions Daily Challenge sur Solana.
 *
 * Expose :
 *  - createDailyChallenge(challengeId)  → crée le DailyChallenge PDA si absent
 *  - startDaily(challengeId)            → enregistre le joueur + ActiveDailyAttempt
 *  - submitDailyScore(challengeId)      → copie le score et ferme ActiveDailyAttempt
 *  - abandonDaily()                     → ferme un ActiveDailyAttempt obsolète
 */

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl";
import { ZKUBE_PROGRAM_ID, getGameStatePda } from "./constants";
import {
  getDailyChallengePda,
  getDailyEntryPda,
  getActiveDailyPda,
} from "./dailyConstants";

export function useSolanaDaily() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  // ── Programme Anchor ────────────────────────────────────────────────────────
  const getProgram = useCallback(() => {
    if (!publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [connection, wallet, publicKey]);

  // ── createDailyChallenge ────────────────────────────────────────────────────
  /**
   * Crée le DailyChallenge PDA pour le jour donné.
   * Permissionless — n'importe quel joueur peut l'appeler.
   * Retourne false si le compte existe déjà (erreur ignorée silencieusement).
   */
  const createDailyChallenge = useCallback(async (challengeId: number): Promise<boolean> => {
    const program = getProgram();
    if (!program || !publicKey) return false;

    // Vérifier si le compte existe déjà
    const pda = getDailyChallengePda(challengeId);
    const existing = await connection.getAccountInfo(pda);
    if (existing) {
      console.log("[Daily] DailyChallenge #" + challengeId + " existe déjà");
      return false;
    }

    try {
      const tx = await (program.methods as any)
        .createDailyChallenge(challengeId)
        .accounts({
          creator: publicKey,
          daily_challenge: pda,
          system_program: SystemProgram.programId,
        })
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signed = await wallet.signTransaction!(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      console.log("[Daily] DailyChallenge #" + challengeId + " créé — tx:", sig);
      return true;
    } catch (err: any) {
      // Ignorer l'erreur si le compte existe déjà (race condition)
      if (err?.message?.includes("already in use") || err?.code === 0) {
        console.log("[Daily] DailyChallenge déjà créé (race condition, ignoré)");
        return false;
      }
      console.error("[Daily] createDailyChallenge error:", err);
      throw err;
    }
  }, [getProgram, publicKey, connection, wallet]);

  // ── startDaily ──────────────────────────────────────────────────────────────
  /**
   * Enregistre le joueur pour le challenge du jour.
   * Crée DailyEntry + ActiveDailyAttempt.
   * Doit être suivi immédiatement de create_game (useSolanaGame).
   */
  const startDaily = useCallback(async (challengeId: number): Promise<void> => {
    const program = getProgram();
    if (!program || !publicKey) throw new Error("Wallet non connecté");

    const dailyChallengePda = getDailyChallengePda(challengeId);
    const dailyEntryPda     = getDailyEntryPda(challengeId, publicKey);
    const activeDailyPda    = getActiveDailyPda(publicKey);

    const tx = await (program.methods as any)
      .startDaily(challengeId)
      .accounts({
        player: publicKey,
        daily_challenge: dailyChallengePda,
        daily_entry: dailyEntryPda,
        active_daily: activeDailyPda,
        system_program: SystemProgram.programId,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;

    const signed = await wallet.signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    console.log("[Daily] startDaily #" + challengeId + " — tx:", sig);
  }, [getProgram, publicKey, connection, wallet]);

  // ── submitDailyScore ────────────────────────────────────────────────────────
  /**
   * Copie le score depuis game_state vers DailyEntry.
   * La partie doit être terminée (game_state.over == true).
   * Ferme ActiveDailyAttempt et rembourse le rent au joueur.
   */
  const submitDailyScore = useCallback(async (challengeId: number): Promise<void> => {
    const program = getProgram();
    if (!program || !publicKey) throw new Error("Wallet non connecté");

    const gameStatePda   = getGameStatePda(publicKey);
    const dailyEntryPda  = getDailyEntryPda(challengeId, publicKey);
    const activeDailyPda = getActiveDailyPda(publicKey);

    const tx = await (program.methods as any)
      .submitDailyScore(challengeId)
      .accounts({
        player: publicKey,
        game_state: gameStatePda,
        daily_entry: dailyEntryPda,
        active_daily: activeDailyPda,
        system_program: SystemProgram.programId,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;

    const signed = await wallet.signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    console.log("[Daily] submitDailyScore #" + challengeId + " — tx:", sig);
  }, [getProgram, publicKey, connection, wallet]);

  // ── abandonDaily ────────────────────────────────────────────────────────────
  /**
   * Ferme l'ActiveDailyAttempt d'un jour précédent.
   * Utile si le joueur a une tentative obsolète qui l'empêche de commencer aujourd'hui.
   */
  const abandonDaily = useCallback(async (): Promise<void> => {
    const program = getProgram();
    if (!program || !publicKey) throw new Error("Wallet non connecté");

    const activeDailyPda = getActiveDailyPda(publicKey);

    const tx = await (program.methods as any)
      .abandonDaily()
      .accounts({
        player: publicKey,
        active_daily: activeDailyPda,
        system_program: SystemProgram.programId,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;

    const signed = await wallet.signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    console.log("[Daily] abandonDaily — tx:", sig);
  }, [getProgram, publicKey, connection, wallet]);

  return {
    createDailyChallenge,
    startDaily,
    submitDailyScore,
    abandonDaily,
  };
}
