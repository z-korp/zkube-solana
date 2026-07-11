import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Lock, Star } from "lucide-react";
import { motion } from "motion/react";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";
import { getThemeColors, getThemeId } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import GameCard from "@/ui/components/shared/GameCard";
import { ZoneBackground } from "@/ui/components/map/ZoneBackground";

const ZONE_NAMES = [
  "Tides",
  "Nile",
  "Frost",
  "Olympus",
  "Dragon",
  "Persia",
  "Foxfire",
  "Jungle",
  "Rhythm",
  "Summit",
];

export default function RebootMapPage() {
  const campaign = useRebootCampaign();
  const initialZone = useNavigationStore((state) => state.mapZoneId);
  const [zone, setZone] = useState(Math.min(10, Math.max(1, initialZone)));
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const setPreviewLevel = useNavigationStore(
    (state) => state.setPendingPreviewLevel,
  );
  const setDaily = useNavigationStore((state) => state.setIsDailyMap);
  const map = campaign.campaign?.maps.find((entry) => entry.mapId === zone);
  const guardian = getZoneGuardian(zone);
  const colors = getThemeColors(getThemeId(zone));
  const stars = map?.levelStars.reduce((sum, value) => sum + value, 0) ?? 0;

  useEffect(() => setMapZoneId(zone), [setMapZoneId, zone]);

  const { setMusicPlaylist } = useMusicPlayer();
  useEffect(() => {
    setMusicPlaylist(["main", "level"]);
  }, [setMusicPlaylist]);

  const firstPlayable = useMemo(() => {
    if (!map) return 1;
    const uncleared = map.levelStars.findIndex((value) => value === 0);
    return uncleared < 0 ? 10 : uncleared + 1;
  }, [map]);

  const play = (level: number) => {
    setMapZoneId(zone);
    setPreviewLevel(level);
    setDaily(false);
    navigate(level === 10 ? "boss" : "solana");
  };

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden pb-24 text-white">
      <ZoneBackground zone={zone} themeId={getThemeId(zone)} />
      <header className="relative z-20 flex items-center justify-between px-4 pb-3 pt-5">
        <button
          onClick={goBack}
          className="rounded-full border border-white/15 bg-black/35 p-2 backdrop-blur"
        >
          <ChevronLeft />
        </button>
        <div className="text-center">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ color: colors.accent }}
          >
            Campaign map
          </p>
          <h1 className="font-display text-2xl font-black">
            {zone}. {ZONE_NAMES[zone - 1]}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-yellow-300/20 bg-black/35 px-3 py-2 text-sm font-black text-yellow-300">
          <Star size={14} fill="currentColor" />
          {stars}/30
        </div>
      </header>

      <div className="relative z-20 flex gap-2 overflow-x-auto px-4 pb-4 [scrollbar-width:none]">
        {Array.from({ length: 10 }, (_, index) => {
          const candidate = campaign.campaign?.maps[index];
          const unlocked = candidate?.unlocked ?? index === 0;
          return (
            <button
              key={index + 1}
              onClick={() => setZone(index + 1)}
              className={`relative min-w-12 rounded-xl border px-3 py-2 font-black transition ${zone === index + 1 ? "border-white/50 bg-white/20" : "border-white/10 bg-black/30 text-white/55"}`}
            >
              {index + 1}
              {!unlocked && (
                <Lock size={9} className="absolute right-1 top-1" />
              )}
            </button>
          );
        })}
      </div>

      <main className="relative z-10 mx-auto grid w-full max-w-4xl flex-1 gap-4 overflow-y-auto px-4 pb-8 md:grid-cols-[18rem_1fr]">
        <GameCard
          variant="glass"
          className="relative overflow-hidden text-center"
        >
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background: `radial-gradient(circle at top, ${colors.accent}, transparent 65%)`,
            }}
          />
          <img
            src={getGuardianPortrait(zone)}
            alt={guardian.name}
            className="relative mx-auto h-52 w-auto object-contain drop-shadow-2xl"
          />
          <div className="relative -mt-5">
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: colors.accent }}
            >
              {guardian.title}
            </p>
            <h2 className="font-display text-3xl font-black">
              {guardian.name}
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/65">
              {guardian.zoneHint}
            </p>
          </div>
        </GameCard>

        <GameCard variant="glass" className="flex flex-col gap-4">
          {campaign.loading && (
            <p className="animate-pulse text-center text-white/55">
              Loading on-chain campaign…
            </p>
          )}
          {!campaign.loading && !map && (
            <p className="text-center text-white/55">
              Start Map 1 to initialize this zKube career.
            </p>
          )}
          {map && (
            <>
              <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
                {map.levelStars.map((levelStars, index) => {
                  const level = index + 1;
                  const available =
                    map.unlocked &&
                    (level === 1 ||
                      map.levelStars[index - 1] > 0 ||
                      level <= firstPlayable);
                  const boss = level === 10;
                  return (
                    <motion.button
                      key={level}
                      whileTap={{ scale: 0.94 }}
                      disabled={!available}
                      onClick={() => play(level)}
                      className={`relative aspect-square rounded-2xl border text-center disabled:opacity-30 ${boss ? "border-red-300/40 bg-red-500/15" : "border-white/15 bg-white/[0.08]"}`}
                    >
                      <strong className="block text-lg">
                        {boss ? guardian.emoji : level}
                      </strong>
                      <span className="mt-1 block text-[10px] text-yellow-300">
                        {"★".repeat(levelStars)}
                        {"☆".repeat(3 - levelStars)}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {!map.unlocked ? (
                <div className="mt-auto space-y-3 rounded-2xl border border-yellow-300/20 bg-yellow-950/30 p-4 text-center">
                  <Lock className="mx-auto text-yellow-300" />
                  <p className="text-sm text-yellow-100">
                    Unlock the full {guardian.name} map.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ArcadeButton
                      disabled={
                        campaign.unlocking ||
                        (campaign.campaign?.starsBalance ?? 0n) < map.starCost
                      }
                      onClick={() => void campaign.unlock(zone, "stars")}
                    >
                      {map.starCost} Stars
                    </ArcadeButton>
                    <ArcadeButton
                      disabled={campaign.unlocking}
                      accentOverride="#10b981"
                      onClick={() => void campaign.unlock(zone, "usdc")}
                    >
                      {formatUsdc(map.usdcCost)} USDC
                    </ArcadeButton>
                  </div>
                </div>
              ) : (
                <div className="mt-auto">
                  <ArcadeButton onClick={() => play(firstPlayable)}>
                    Play level {firstPlayable}
                  </ArcadeButton>
                </div>
              )}
            </>
          )}
          {campaign.error && (
            <p className="text-center text-xs text-red-300">{campaign.error}</p>
          )}
        </GameCard>
      </main>
    </div>
  );
}

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
