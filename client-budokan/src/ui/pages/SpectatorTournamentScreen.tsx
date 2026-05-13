/**
 * SpectatorTournamentScreen — vue tournoi en lecture seule.
 * URL: ?tournament=<tournamentId>&botpda=<gameStatePda>
 *
 * Affiche uniquement la grille du bot + un mini bandeau flottant
 * avec rang, meilleur score, countdown et prize pool.
 * Pas de wallet requis.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_ENDPOINT, ZKUBE_PROGRAM_ID } from "@/solana/constants";
import { getThemeId } from "@/config/themes";
import type { ThemeId } from "@/config/themes";
import SpectatorScreen from "./SpectatorScreen";
import "../../grid.css";

// ── Constants ─────────────────────────────────────────────────────────────────
const TOURNAMENT_DURATION_SEC = 48 * 3600;
const LEADERBOARD_REFRESH_MS  = 30_000;
const COUNTDOWN_REFRESH_MS    = 5_000;
const TOURNAMENT_ENTRY_SIZE   = 58;

const DISC_ACC_TOURNAMENT       = Buffer.from([175, 139, 119, 242, 115, 194,  57,  92]);
const DISC_ACC_TOURNAMENT_ENTRY = Buffer.from([ 36, 203, 172, 114, 100, 189, 217, 158]);

// ── PDA helpers ───────────────────────────────────────────────────────────────
function getTournamentPda(tournamentId: number): PublicKey {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(tournamentId, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tournament"), idBuf],
    ZKUBE_PROGRAM_ID,
  );
  return pda;
}

// ── Deserialization ───────────────────────────────────────────────────────────
interface TournamentData {
  endTime:   number;
  prizePool: bigint;
  settled:   boolean;
  zoneId:    number;
}

interface LeaderboardEntry {
  player:    string;
  bestScore: number;
}

function parseTournament(data: Buffer): TournamentData | null {
  if (data.length < 54) return null;
  if (!data.subarray(0, 8).equals(DISC_ACC_TOURNAMENT)) return null;
  return {
    endTime:   Number(data.readBigInt64LE(20)),
    zoneId:    data.readUInt8(28),           // u8 zone_id → thème
    prizePool: data.readBigUInt64LE(37),
    settled:   data.readUInt8(53) !== 0,
  };
}

function parseTournamentEntry(data: Buffer): LeaderboardEntry | null {
  if (data.length < 58) return null;
  if (!data.subarray(0, 8).equals(DISC_ACC_TOURNAMENT_ENTRY)) return null;
  return {
    player:    new PublicKey(data.subarray(12, 44)).toBase58(),
    bestScore: data.readUInt32LE(44),
  };
}

function formatCountdown(secsLeft: number): string {
  if (secsLeft <= 0) return "Ended";
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  const s = secsLeft % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SpectatorTournamentScreen({
  tournamentId,
  botPda,
}: {
  tournamentId: number;
  botPda: string | null;
}) {
  const [tournament, setTournament] = useState<TournamentData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [secsLeft, setSecsLeft] = useState(0);

  const connection = useRef(new Connection(SOLANA_ENDPOINT, "confirmed")).current;

  // ── Fetch tournament + leaderboard ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const pda  = getTournamentPda(tournamentId);
      const info = await connection.getAccountInfo(pda);
      if (!info) return;
      const t = parseTournament(info.data);
      if (t) setTournament(t);
    } catch { /* silent */ }

    try {
      const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ dataSize: TOURNAMENT_ENTRY_SIZE }],
      });
      const entries: LeaderboardEntry[] = [];
      for (const { account } of accounts) {
        const tid = account.data.readUInt32LE(8);
        if (tid !== tournamentId) continue;
        const e = parseTournamentEntry(account.data);
        if (e && e.bestScore > 0) entries.push(e);
      }
      entries.sort((a, b) => b.bestScore - a.bestScore);
      setLeaderboard(entries.slice(0, 10));
    } catch { /* silent */ }
  }, [tournamentId, connection]);

  // ── Countdown tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournament) return;
    const update = () =>
      setSecsLeft(Math.max(0, tournament.endTime - Math.floor(Date.now() / 1000)));
    update();
    const id = window.setInterval(update, COUNTDOWN_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [tournament]);

  // ── Periodic fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchData();
    const id = window.setInterval(() => void fetchData(), LEADERBOARD_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  // ── Thème basé sur le zone_id du tournoi ───────────────────────────────────
  const theme: ThemeId = tournament ? getThemeId(tournament.zoneId) : "theme-1";

  // ── Rang du bot dans le leaderboard ────────────────────────────────────────
  const botRank = botPda
    ? leaderboard.findIndex((e) => botPda.startsWith(e.player.slice(0, 8))) + 1
    : 0;
  const botBestScore = botRank > 0 ? (leaderboard[botRank - 1]?.bestScore ?? 0) : 0;
  const prizeSOL     = tournament ? (Number(tournament.prizePool) / 1e9).toFixed(3) : "—";
  const isActive     = tournament && !tournament.settled && secsLeft > 0;

  // ── Pas de botPda : écran d'attente ────────────────────────────────────────
  if (!botPda) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white flex-col gap-4">
        <div className="text-5xl">🏆</div>
        <div className="text-white/60 text-sm font-mono">Tournament #{tournamentId}</div>
        <div className="text-white/30 text-xs">Waiting for bot to start a game…</div>
        {tournament && (
          <div className="text-white/20 text-[10px] mt-2">
            {isActive
              ? `⏱ ${formatCountdown(secsLeft)} · ${prizeSOL} SOL prize pool`
              : "Tournament ended"}
          </div>
        )}
      </div>
    );
  }

  // ── Vue principale : grille pleine + mini bandeau ──────────────────────────
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">

      {/* ── Grille full-screen avec le thème du tournoi ── */}
      <div className="absolute inset-0">
        <SpectatorScreen pda={botPda} theme={theme} />
      </div>

      {/* ── Mini bandeau flottant en haut ── */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
                      px-3 py-1.5 bg-black/55 backdrop-blur-sm border-b border-white/10">

        {/* Identité tournoi */}
        <div className="flex items-center gap-2">
          <span className="text-purple-400 font-mono text-[10px] font-bold">zKube</span>
          <span className="text-white/20 text-[10px]">·</span>
          <span className="text-white/70 text-[10px]">Tournament #{tournamentId}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            tournament?.settled   ? "bg-gray-800 text-gray-400"
            : !isActive && tournament ? "bg-orange-900/60 text-orange-300"
            : isActive            ? "bg-green-900/60 text-green-300"
            :                       "bg-white/10 text-white/30"
          }`}>
            {tournament?.settled ? "Settled" : !isActive && tournament ? "Ended" : isActive ? "Live" : "…"}
          </span>
        </div>

        {/* Rang + meilleur score tournoi du bot */}
        {botRank > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-yellow-400 font-bold text-sm leading-none">
                {botRank === 1 ? "🥇" : botRank === 2 ? "🥈" : botRank === 3 ? "🥉" : `#${botRank}`}
              </div>
              <div className="text-white/30 text-[9px] uppercase tracking-wide">Rank</div>
            </div>
            <div className="text-center">
              <div className="text-cyan-400 font-bold text-sm leading-none">{botBestScore}</div>
              <div className="text-white/30 text-[9px] uppercase tracking-wide">Best</div>
            </div>
          </div>
        )}

        {/* Countdown + prize pool */}
        <div className="flex items-center gap-3">
          {tournament && (
            <>
              <div className="text-center">
                <div className="text-yellow-400 font-bold text-sm leading-none">{prizeSOL}</div>
                <div className="text-white/30 text-[9px] uppercase tracking-wide">SOL</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-sm leading-none font-mono ${
                  secsLeft < 3600 ? "text-red-400" : "text-white/80"
                }`}>
                  {formatCountdown(secsLeft)}
                </div>
                <div className="text-white/30 text-[9px] uppercase tracking-wide">Left</div>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
