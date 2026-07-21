import { useMemo } from "react";
import { ChevronRight, Gamepad2, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import { useRun } from "@/contexts/run";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { usePlayerMeta } from "@/hooks/usePlayerMeta";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import PageHeader from "@/ui/components/shared/PageHeader";
import PlayerIdentityHeader from "@/ui/components/shared/PlayerIdentityHeader";
import { formatSolLamports } from "@/utils/currency";
import {
  LEVEL_THRESHOLDS,
  getLevelFromXp,
  getTitleForLevel,
} from "@/config/profileData";
import { usePlayerLabelController } from "@/chain/usePlayerLabelController";

/** Arcade-first landing surface. Campaign deliberately lives on its own tab. */
const HomePage: React.FC = () => {
  const navigate = useNavigationStore((state) => state.navigate);
  const { address } = useAccount();
  const player = useConnectedPlayer();
  const daily = useDaily();
  const run = useRun();
  const activeDaily = useActiveDailyAttempt();
  const { playerMeta } = usePlayerMeta(address);
  const label = usePlayerLabelController();

  const xp = playerMeta?.lifetimeXp ?? 0;
  const level = getLevelFromXp(xp);
  const startXp = LEVEL_THRESHOLDS[Math.max(0, level - 1)] ?? 0;
  const nextXp = LEVEL_THRESHOLDS[level] ?? startXp;
  const progress =
    level >= LEVEL_THRESHOLDS.length
      ? 1
      : (xp - startXp) / Math.max(1, nextXp - startXp);
  const zoneId = daily.daily?.mapId ?? 1;
  const colors = getThemeColors(getThemeId(zoneId));
  const images = getThemeImages(getThemeId(zoneId));
  const now = Math.floor(Date.now() / 1_000);
  const entriesOpen = Boolean(
    daily.daily?.status === "open" &&
      daily.daily.opensAt <= now &&
      daily.daily.entriesCloseAt > now,
  );
  const entrySol = daily.daily
    ? `${formatSolLamports(daily.daily.entryLamports)} SOL`
    : "0.02 SOL";
  const canEnter =
    entriesOpen && (run.phase === "none" || run.phase === "missing");
  const activePot = daily.daily
    ? `${formatSolLamports(daily.daily.dailyPotLamports)} SOL`
    : "—";
  const followingPot = daily.daily?.followingDailyLamports;
  const attempts = useMemo(
    () => daily.daily?.player?.finalizedAttempts ?? 0,
    [daily.daily?.player?.finalizedAttempts],
  );

  const enterRanked = async () => {
    if (activeDaily) {
      navigate("play", activeDaily.gameId);
      return;
    }
    const active = await daily.enter();
    navigate("play", active.runId);
  };

  const enterPractice = async () => {
    if (activeDaily) {
      navigate("play", activeDaily.gameId);
      return;
    }
    const active = await daily.practice();
    navigate("play", active.runId);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <img
        src={images.background}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,18,0.55),rgba(2,5,13,0.96))]" />

      <div className="relative z-10">
        <PageHeader title="Arcade" />
      </div>
      <div className="relative z-10 mx-4 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 hide-scrollbar">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/[0.14] bg-black/35 p-4 backdrop-blur-xl"
        >
          <PlayerIdentityHeader
            level={level}
            progress={progress}
            displayName={label.label?.displayName}
            title={getTitleForLevel(level)}
            address={address}
          />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 }}
          className="overflow-hidden rounded-3xl border bg-black/45 backdrop-blur-xl"
          style={{ borderColor: `${colors.accent}55` }}
        >
          <div className="flex items-start gap-3 p-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${colors.accent}22`, color: colors.accent }}
            >
              <Gamepad2 />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-black text-white">Daily Arena</p>
              <p className="mt-1 text-xs font-semibold text-white/55">
                Every ranked run is a separate owner-signed {entrySol} entry.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("ranks")}
              className="rounded-xl border border-white/15 bg-white/[0.06] p-2 text-white/65"
              aria-label="Open rankings"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <FundingTile label="Active guaranteed pot" value={activePot} />
            <FundingTile label="Following Daily funding" value={followingPot === null || followingPot === undefined ? "Being prepared" : `${formatSolLamports(followingPot)} SOL`} />
          </div>
          <div className="border-t border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
            {attempts} finalized attempt{attempts === 1 ? "" : "s"} today · prizes are pushed automatically
          </div>
        </motion.section>

        <section className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!daily.practiceAvailable || daily.action !== null || !player.wallet}
            onClick={() => void enterPractice().catch(() => undefined)}
            className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] p-4 text-left"
          >
            <Sparkles className="mb-3 text-cyan-200" size={22} />
            <p className="font-sans text-sm font-black text-white">Yesterday Practice</p>
            <p className="mt-1 text-[11px] font-semibold text-white/50">{daily.action === "practice" ? "Preparing…" : daily.practiceAvailable ? "Free · fresh VRF · unranked · enter before 23:30 UTC" : daily.practiceDaily ? "Entry closed · returns after UTC reset" : "Available after Daily finalization"}</p>
          </button>
          <button
            type="button"
            onClick={() => navigate("ranks")}
            className="rounded-2xl border border-violet-300/20 bg-violet-300/[0.08] p-4 text-left"
          >
            <ShieldCheck className="mb-3 text-violet-200" size={22} />
            <p className="font-sans text-sm font-black text-white">World-verifiable</p>
            <p className="mt-1 text-[11px] font-semibold text-white/50">Replay-bound scores · no claims</p>
          </button>
        </section>

        {daily.error && (
          <p role="alert" className="text-center text-xs font-semibold text-red-300">
            {daily.error}
          </p>
        )}
      </div>

      <div className="relative z-20 px-4 pb-3">
        <ArcadeButton
          disabled={!activeDaily && (!canEnter || daily.action !== null || !player.wallet)}
          onClick={() => void enterRanked().catch(() => undefined)}
          accentOverride={colors.accent}
        >
          {activeDaily
            ? "Resume ranked run"
            : daily.action
              ? "Preparing owner signature…"
              : `Enter ranked · ${entrySol}`}
        </ArcadeButton>
        {!activeDaily && (
          <p className="mt-1.5 text-center font-sans text-[10px] font-semibold text-white/45">
            Your wallet will review the exact SOL transfer before signing.
          </p>
        )}
      </div>
    </div>
  );
};

function FundingTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 font-sans text-sm font-black text-white">{value}</p>
    </div>
  );
}

export default HomePage;
