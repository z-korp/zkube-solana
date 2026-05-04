/**
 * useSolanaTournament — Tournois zKube sur Solana.
 *
 * Expose :
 *  Fetch
 *  - fetchTournament(tournamentId)      → données Tournament PDA
 *  - fetchMyEntry(tournamentId)         → TournamentEntry du wallet connecté
 *  - fetchLeaderboard(tournamentId)     → toutes les entries triées (score DESC)
 *
 *  Actions
 *  - joinTournament(tournamentId)       → 1ère inscription (0.1 SOL)
 *  - rejoinTournament(tournamentId)     → replay (0.1 SOL supplémentaire)
 *  - submitTournamentScore(tournamentId)→ soumet le score depuis game_state
 *  - settleTournament(tournamentId)     → permissionless settle après end_time
 *  - claimPrize(tournamentId)           → le gagnant réclame son prize
 *
 *  Helpers
 *  - getSecondsRemaining(tournament)    → secondes avant end_time
 *  - formatCountdown(seconds)           → "HH:MM:SS" ou "Xj HH:MM:SS"
 */

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl";
import {
  ZKUBE_PROGRAM_ID,
  getGameStatePda,
  getTreasuryPda,
  getTournamentPda,
  getTournamentEntryPda,
} from "./constants";

const ACTIVE_GAME_PDA_PREFIX = "zkube_game_pda_";

function loadActiveGamePda(playerPubkey: string): PublicKey | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_PDA_PREFIX + playerPubkey);
    return raw ? new PublicKey(raw) : null;
  } catch {
    return null;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TournamentData {
  tournamentId: number;
  startTime: number;       // Unix timestamp (secondes)
  endTime: number;         // Unix timestamp (secondes)
  zoneId: number;
  entryFee: bigint;        // lamports
  prizePool: bigint;       // lamports
  totalPlayers: number;
  totalAttempts: number;
  settled: boolean;
  winner1: PublicKey;
  prize1: bigint;
  winner2: PublicKey;
  prize2: bigint;
  winner3: PublicKey;
  prize3: bigint;
}

export interface TournamentEntryData {
  tournamentId: number;
  player: PublicKey;
  bestScore: number;
  submittedAt: number;  // Unix timestamp
  attempts: number;
  hasSubmitted: boolean;
}

// Taille Borsh d'un compte TournamentEntry (discriminant 8 + données 50 = 58)
const TOURNAMENT_ENTRY_SIZE = 58;
export const TOURNAMENT_DURATION_SECONDS = 48 * 3600;

export function getCurrentTournamentId(nowSec = Math.floor(Date.now() / 1000)): number {
  return Math.floor(nowSec / TOURNAMENT_DURATION_SECONDS);
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useSolanaTournament() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  // ── Programme Anchor ─────────────────────────────────────────────────────────
  const getProgram = useCallback(() => {
    if (!publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [connection, wallet, publicKey]);

  // ── fetchTournament ──────────────────────────────────────────────────────────
  /**
   * Récupère les données du tournoi depuis la chain.
   * Retourne null si le compte n'existe pas encore.
   */
  const fetchTournament = useCallback(
    async (tournamentId: number): Promise<TournamentData | null> => {
      const program = getProgram();
      if (!program) return null;

      try {
        const pda = getTournamentPda(tournamentId);
        const raw = await (program.account as any).tournament.fetch(pda);
        return {
          tournamentId:  raw.tournamentId,
          startTime:     Number(raw.startTime),
          endTime:       Number(raw.endTime),
          zoneId:        raw.zoneId,
          entryFee:      BigInt(raw.entryFee.toString()),
          prizePool:     BigInt(raw.prizePool.toString()),
          totalPlayers:  raw.totalPlayers,
          totalAttempts: raw.totalAttempts,
          settled:       raw.settled,
          winner1:       raw.winner1,
          prize1:        BigInt(raw.prize1.toString()),
          winner2:       raw.winner2,
          prize2:        BigInt(raw.prize2.toString()),
          winner3:       raw.winner3,
          prize3:        BigInt(raw.prize3.toString()),
        };
      } catch (e) {
        console.error("[Tournament] fetchTournament #" + tournamentId + " error:", e);
        return null;
      }
    },
    [getProgram]
  );

  // ── fetchMyEntry ─────────────────────────────────────────────────────────────
  /**
   * Récupère l'entry du wallet connecté pour un tournoi.
   * Retourne null si le joueur n'est pas inscrit.
   */
  const fetchMyEntry = useCallback(
    async (tournamentId: number): Promise<TournamentEntryData | null> => {
      const program = getProgram();
      if (!program || !publicKey) return null;

      try {
        const pda = getTournamentEntryPda(tournamentId, publicKey);
        const raw = await (program.account as any).tournamentEntry.fetch(pda);
        return {
          tournamentId: raw.tournamentId,
          player:       raw.player,
          bestScore:    raw.bestScore,
          submittedAt:  Number(raw.submittedAt),
          attempts:     raw.attempts,
          hasSubmitted: raw.hasSubmitted,
        };
      } catch {
        return null; // compte inexistant = joueur non inscrit
      }
    },
    [getProgram, publicKey]
  );

  // ── fetchLeaderboard ─────────────────────────────────────────────────────────
  /**
   * Récupère toutes les TournamentEntry du tournoi via getProgramAccounts.
   * Filtre sur tournament_id (offset 8, 4 bytes LE) et taille de compte.
   * Tri identique au on-chain : score DESC, submitted_at ASC (tiebreaker).
   */
  const fetchLeaderboard = useCallback(
    async (tournamentId: number): Promise<TournamentEntryData[]> => {
      const program = getProgram();
      if (!program) return [];

      // Encoder tournament_id en 4 bytes LE pour le filtre memcmp
      const idBuf = Buffer.alloc(4);
      idBuf.writeUInt32LE(tournamentId, 0);

      try {
        const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            { dataSize: TOURNAMENT_ENTRY_SIZE },
            // offset 8 = après le discriminant Anchor (8 bytes)
            {
              memcmp: {
                offset: 8,
                bytes: idBuf.toString("base64"),
                encoding: "base64" as any,
              },
            },
          ],
        });

        const entries: TournamentEntryData[] = [];
        for (const { account } of accounts) {
          try {
            const raw = program.coder.accounts.decode("TournamentEntry", account.data);
            entries.push({
              tournamentId: raw.tournamentId,
              player:       raw.player,
              bestScore:    raw.bestScore,
              submittedAt:  Number(raw.submittedAt),
              attempts:     raw.attempts,
              hasSubmitted: raw.hasSubmitted,
            });
          } catch {
            // compte mal formé — on ignore
          }
        }

        // Tri identique au settle on-chain
        entries.sort((a, b) => {
          if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
          return a.submittedAt - b.submittedAt;
        });

        return entries;
      } catch (e) {
        console.error("[Tournament] fetchLeaderboard #" + tournamentId + " error:", e);
        return [];
      }
    },
    [connection, getProgram]
  );

  // ── Helper interne : sign + send + confirm ────────────────────────────────────
  const sendTx = useCallback(
    async (tx: any): Promise<string> => {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey!;

      const signed = await wallet.signTransaction!(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      return sig;
    },
    [connection, wallet, publicKey]
  );

  // ── joinTournament ────────────────────────────────────────────────────────────
  const createTournament = useCallback(
    async (tournamentId = getCurrentTournamentId()): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const tournamentPda = getTournamentPda(tournamentId);
      const treasuryPda   = getTreasuryPda();

      const tx = await (program.methods as any)
        .createTournament(tournamentId)
        .accounts({
          authority:     publicKey,
          treasury:      treasuryPda,
          tournament:    tournamentPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] createTournament #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, sendTx]
  );

  // ── joinTournament ────────────────────────────────────────────────────────────
  /**
   * Première inscription au tournoi.
   * Transfère 0.1 SOL (10% treasury, 90% prize pool).
   * Crée le TournamentEntry du joueur.
   */
  const joinTournament = useCallback(
    async (tournamentId: number): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const tournamentPda = getTournamentPda(tournamentId);
      const entryPda      = getTournamentEntryPda(tournamentId, publicKey);
      const treasuryPda   = getTreasuryPda();

      const tx = await (program.methods as any)
        .joinTournament(tournamentId)
        .accounts({
          player:          publicKey,
          tournament:      tournamentPda,
          tournamentEntry: entryPda,
          treasury:        treasuryPda,
          systemProgram:   SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] joinTournament #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, sendTx]
  );

  // ── rejoinTournament ──────────────────────────────────────────────────────────
  /**
   * Replay — paie à nouveau l'entry fee pour une nouvelle tentative.
   * Le TournamentEntry existe déjà (créé par joinTournament).
   */
  const rejoinTournament = useCallback(
    async (tournamentId: number): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const tournamentPda = getTournamentPda(tournamentId);
      const entryPda      = getTournamentEntryPda(tournamentId, publicKey);
      const treasuryPda   = getTreasuryPda();

      const tx = await (program.methods as any)
        .rejoinTournament(tournamentId)
        .accounts({
          player:          publicKey,
          tournament:      tournamentPda,
          tournamentEntry: entryPda,
          treasury:        treasuryPda,
          systemProgram:   SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] rejoinTournament #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, sendTx]
  );

  // ── submitTournamentScore ─────────────────────────────────────────────────────
  /**
   * Soumet le score depuis game_state vers le TournamentEntry.
   * La partie doit être terminée (game_state.over == true).
   * Met à jour best_score uniquement si le nouveau score est supérieur.
   */
  const submitTournamentScore = useCallback(
    async (tournamentId: number): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const gameStatePda  =
        loadActiveGamePda(publicKey.toBase58()) ?? getGameStatePda(publicKey);
      const tournamentPda = getTournamentPda(tournamentId);
      const entryPda      = getTournamentEntryPda(tournamentId, publicKey);

      const tx = await (program.methods as any)
        .submitTournamentScore(tournamentId)
        .accounts({
          player:          publicKey,
          gameState:       gameStatePda,
          tournament:      tournamentPda,
          tournamentEntry: entryPda,
        })
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] submitTournamentScore #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, sendTx]
  );

  // ── settleTournament ──────────────────────────────────────────────────────────
  /**
   * Calcule le top 3 et stocke les résultats dans Tournament.
   * Permissionless — n'importe qui peut appeler après end_time.
   * Toutes les TournamentEntry sont passées en remaining_accounts (lecture seule).
   */
  const settleTournament = useCallback(
    async (tournamentId: number): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const tournamentPda = getTournamentPda(tournamentId);

      // Récupérer toutes les entries pour les passer en remaining_accounts
      const idBuf = Buffer.alloc(4);
      idBuf.writeUInt32LE(tournamentId, 0);

      const rawAccounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { dataSize: TOURNAMENT_ENTRY_SIZE },
          {
            memcmp: {
              offset: 8,
              bytes: idBuf.toString("base64"),
              encoding: "base64" as any,
            },
          },
        ],
      });

      const remainingAccounts: AccountMeta[] = rawAccounts.map(({ pubkey }) => ({
        pubkey,
        isWritable: false,
        isSigner:   false,
      }));

      console.log(
        "[Tournament] settleTournament #" + tournamentId +
        " — " + remainingAccounts.length + " entries trouvées"
      );

      const tx = await (program.methods as any)
        .settleTournament(tournamentId)
        .accounts({
          caller:     publicKey,
          tournament: tournamentPda,
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] settleTournament #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, connection, sendTx]
  );

  // ── claimPrize ────────────────────────────────────────────────────────────────
  /**
   * Le joueur gagnant réclame son prize après le settle.
   * Le contrat vérifie que le wallet est bien un des 3 gagnants.
   * Anti-double-claim : le prize est mis à 0 après distribution.
   */
  const claimPrize = useCallback(
    async (tournamentId: number): Promise<string> => {
      const program = getProgram();
      if (!program || !publicKey) throw new Error("Wallet non connecté");

      const tournamentPda = getTournamentPda(tournamentId);

      const tx = await (program.methods as any)
        .claimPrize(tournamentId)
        .accounts({
          player:        publicKey,
          tournament:    tournamentPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTx(tx);
      console.log("[Tournament] claimPrize #" + tournamentId + " — tx:", sig);
      return sig;
    },
    [getProgram, publicKey, sendTx]
  );

  // ── Helpers countdown ─────────────────────────────────────────────────────────

  /**
   * Retourne les secondes restantes avant la fin du tournoi.
   * Retourne 0 si le tournoi est terminé ou settle.
   */
  const getSecondsRemaining = useCallback(
    (tournament: TournamentData): number => {
      if (tournament.settled) return 0;
      const now = Math.floor(Date.now() / 1000);
      return Math.max(0, tournament.endTime - now);
    },
    []
  );

  /**
   * Formate un nombre de secondes en chaîne lisible.
   * Exemples : "02:34:07", "1j 14:22:00"
   */
  const formatCountdown = useCallback((seconds: number): string => {
    if (seconds <= 0) return "Terminé";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    if (d > 0) return `${d}j ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, []);

  /**
   * Indique si le wallet connecté est parmi les gagnants du tournoi.
   * Retourne le numéro du rang (1, 2, 3) ou null.
   */
  const getMyPrizeRank = useCallback(
    (tournament: TournamentData): 1 | 2 | 3 | null => {
      if (!publicKey || !tournament.settled) return null;
      const key = publicKey.toBase58();
      if (tournament.winner1.toBase58() === key && tournament.prize1 > 0n) return 1;
      if (tournament.winner2.toBase58() === key && tournament.prize2 > 0n) return 2;
      if (tournament.winner3.toBase58() === key && tournament.prize3 > 0n) return 3;
      return null;
    },
    [publicKey]
  );

  // ── API publique ───────────────────────────────────────────────────────────────
  return {
    // Fetch
    fetchTournament,
    fetchMyEntry,
    fetchLeaderboard,
    // Actions
    createTournament,
    joinTournament,
    rejoinTournament,
    submitTournamentScore,
    settleTournament,
    claimPrize,
    // Helpers
    getSecondsRemaining,
    formatCountdown,
    getMyPrizeRank,
  };
}
