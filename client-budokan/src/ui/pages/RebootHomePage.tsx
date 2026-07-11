import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Star,
  Trophy,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { ZONE_NAMES } from "@/config/profileData";
import { useDevnetRuntimeStatus } from "@/solana/reboot/useDevnetRuntimeStatus";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useRebootProgress } from "@/solana/reboot/useRebootProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import GameCard from "@/ui/components/shared/GameCard";

export default function RebootHomePage() {
  const runtime = useDevnetRuntimeStatus();
  const identity = useEmbeddedIdentity();
  const campaign = useRebootCampaign();
  const progress = useRebootProgress();
  const navigate = useNavigationStore((state) => state.navigate);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const setDaily = useNavigationStore((state) => state.setIsDailyMap);
  const unlockedMaps =
    campaign.campaign?.maps.filter((map) => map.unlocked) ?? [];
  const initialZone = unlockedMaps.at(-1)?.mapId ?? 1;
  const [zone, setZone] = useState(initialZone);
  const map = campaign.campaign?.maps.find((entry) => entry.mapId === zone);
  const guardian = getZoneGuardian(zone);
  const theme = getThemeId(zone);
  const colors = getThemeColors(theme);
  const images = getThemeImages(theme);
  const runtimeReady = runtime.phase === "ready";
  const stars = map?.levelStars.reduce((sum, value) => sum + value, 0) ?? 0;
  const activeQuests =
    progress.progress?.quests.filter((quest) => quest.active) ?? [];
  const questClaims = activeQuests.filter((quest) => quest.claimed).length;
  const shortAddress = useMemo(
    () => shortKey(identity.publicKey.toBase58()),
    [identity.publicKey],
  );

  const openMap = () => {
    setMapZoneId(zone);
    setDaily(false);
    navigate("map");
  };
  const openDaily = () => {
    setDaily(true);
    navigate("daily");
  };

  return (
    <div className="relative min-h-full overflow-y-auto pb-28 text-white">
      <div
        className="fixed inset-0 -z-20"
        style={{ backgroundColor: colors.background }}
      >
        <img
          src={images.background}
          alt=""
          className="h-full w-full object-cover opacity-70"
        />
      </div>
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(180deg,rgba(2,6,23,.28),rgba(2,6,23,.94))]" />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-3 pt-5">
        <img
          src="/assets/theme-1/logo.png"
          alt="zKube"
          className="h-12 w-auto"
        />
        <button
          onClick={() => navigate("profile")}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-xl"
        >
          <div className="text-right">
            <strong className="block text-sm">zKube Vault</strong>
            <span className="block font-mono text-[9px] text-white/40">
              {shortAddress}
            </span>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-cyan-500/20 text-cyan-200">
            <ShieldCheck size={18} />
          </div>
        </button>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-4 px-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            icon={<Star fill="currentColor" />}
            label="Stars"
            value={(campaign.campaign?.starsBalance ?? 0n).toString()}
            color="#facc15"
          />
          <Stat
            icon={<Trophy />}
            label="Map stars"
            value={`${stars}/30`}
            color={colors.accent}
          />
          <Stat
            icon={<Zap />}
            label="Quests"
            value={`${questClaims}/${activeQuests.length || 5}`}
            color="#c084fc"
          />
        </div>

        <div
          className={`rounded-full border px-4 py-2 text-center text-xs font-bold ${runtimeReady ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-500/10 text-amber-200"}`}
        >
          {runtime.message}
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.45fr_.75fr]">
          <GameCard
            variant="glass"
            className="relative min-h-[410px] overflow-hidden p-0"
          >
            <img
              src={images.mapBg}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-40"
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, ${colors.background}f2 0%, ${colors.background}90 48%, transparent 100%)`,
              }}
            />
            <div className="relative flex h-full min-h-[410px] flex-col justify-between p-5 sm:w-[62%]">
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-[.3em]"
                  style={{ color: colors.accent }}
                >
                  Map {zone} · {ZONE_NAMES[zone]}
                </p>
                <h1 className="mt-2 font-display text-4xl font-black">
                  {guardian.name}
                </h1>
                <p
                  className="text-sm font-bold"
                  style={{ color: colors.accent }}
                >
                  {guardian.title}
                </p>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/65">
                  {guardian.greeting}
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() =>
                      setZone((value) => (value <= 1 ? 10 : value - 1))
                    }
                    className="rounded-full border border-white/15 bg-black/30 p-2"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: 10 }, (_, index) => (
                      <button
                        key={index}
                        onClick={() => setZone(index + 1)}
                        className={`h-2 rounded-full transition-all ${zone === index + 1 ? "w-6" : "w-2 bg-white/25"}`}
                        style={
                          zone === index + 1
                            ? { backgroundColor: colors.accent }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setZone((value) => (value >= 10 ? 1 : value + 1))
                    }
                    className="rounded-full border border-white/15 bg-black/30 p-2"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <ArcadeButton disabled={!runtimeReady} onClick={openMap}>
                  {(map?.unlocked ?? zone === 1)
                    ? "Enter campaign"
                    : "View locked map"}
                </ArcadeButton>
              </div>
            </div>
            <motion.img
              key={zone}
              initial={{ opacity: 0, x: 35 }}
              animate={{ opacity: 1, x: 0 }}
              src={getGuardianPortrait(zone)}
              alt={guardian.name}
              className="pointer-events-none absolute bottom-0 right-[-5%] hidden h-[92%] object-contain drop-shadow-2xl sm:block"
            />
          </GameCard>

          <div className="flex flex-col gap-4">
            <GameCard
              variant="glass"
              className="relative flex-1 overflow-hidden"
            >
              <div className="absolute right-[-2rem] top-[-2rem] h-32 w-32 rounded-full bg-purple-500/20 blur-2xl" />
              <Trophy className="text-purple-300" />
              <h2 className="mt-3 font-display text-2xl font-black">
                Daily Arena
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/55">
                One immutable challenge, one authoritative leaderboard, USDC
                prizes, and MagicBlock VRF rows.
              </p>
              <button
                disabled={!runtimeReady}
                onClick={openDaily}
                className="mt-5 w-full rounded-xl border border-purple-300/25 bg-purple-500/20 px-4 py-3 font-black text-purple-100 disabled:opacity-35"
              >
                Compete today
              </button>
            </GameCard>
            <GameCard variant="glass">
              <h3 className="font-display text-lg font-black">
                Today’s rewards
              </h3>
              <p className="mt-1 text-xs text-white/50">
                {questClaims} of {activeQuests.length || 5} active quests
                claimed
              </p>
              <button
                onClick={() => navigate("rewards")}
                className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-black"
              >
                Open rewards
              </button>
            </GameCard>
          </div>
        </section>
        {(campaign.error || progress.error) && (
          <p className="text-center text-xs text-red-300">
            {campaign.error ?? progress.error}
          </p>
        )}
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/35 p-3 backdrop-blur-xl">
      <span style={{ color }}>{icon}</span>
      <span>
        <strong className="block text-lg leading-none" style={{ color }}>
          {value}
        </strong>
        <small className="text-[9px] uppercase text-white/35">{label}</small>
      </span>
    </div>
  );
}

function shortKey(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}
