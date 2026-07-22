import { useEffect, useMemo } from "react";
import { ChevronRight, LockKeyhole, Star } from "lucide-react";
import { motion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import useAccount from "@/hooks/useAccount";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import { GuardianMedallion } from "@/ui/components/economy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import PageHeader from "@/ui/components/shared/PageHeader";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useTheme, useThemeColors } from "@/ui/elements/theme-provider/hooks";

/** Star gold, shared with the Arcade/Leaderboard reward surfaces. */
const STAR_GOLD = "#FACC15";

/**
 * Campaign landing — the free guardian-realm map, re-skinned into the shared
 * visual identity: the current realm's painted art shows through a ZoneBackdrop,
 * with translucent glass panels layered over it (the same treatment as the
 * Arcade home). Each realm reads as a glass card over its own zone art, carries
 * its zone accent, and shows lifetime star progress in gold. Campaign stays
 * free and moneyless; tapping a realm opens the existing MapPage.
 */
export default function CampaignPage() {
  const { address } = useAccount();
  const { zones, totalStars, isLoading } = useZoneProgress(address);
  const activeRun = useActiveStoryAttempt();
  const navigate = useNavigationStore((state) => state.navigate);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const { setMusicMood } = useMusicPlayer();
  const { setThemeTemplate } = useTheme();
  const colors = useThemeColors();

  useEffect(() => setMusicMood("menu"), [setMusicMood]);

  // The realm the player is currently in: the resume run's realm, else the
  // furthest unlocked realm, else the first. Drives the backdrop art + accent.
  const currentZoneId = useMemo(() => {
    if (activeRun) return activeRun.zoneId;
    const unlocked = zones.filter((zone) => zone.unlocked);
    if (unlocked.length === 0) return 1;
    return unlocked.reduce((max, zone) => Math.max(max, zone.zoneId), 1);
  }, [activeRun, zones]);

  // Tint the whole surface with the current realm's accent (never persisted),
  // mirroring the Arcade home so both modes read as one product.
  useEffect(() => {
    setThemeTemplate(getThemeId(currentZoneId), false);
  }, [currentZoneId, setThemeTemplate]);

  const openZone = (zoneId: number) => {
    setMapZoneId(zoneId);
    navigate("map");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <ZoneBackdrop zoneId={currentZoneId} />

      <div className="relative z-10">
        <PageHeader title="Campaign" />
      </div>

      <div className="relative z-10 mx-4 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 hide-scrollbar">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/[0.1] bg-black/30 p-4 backdrop-blur-xl"
          style={{ boxShadow: `0 4px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.accent}15` }}
        >
          <div className="flex items-center gap-3">
            <GuardianMedallion zoneId={currentZoneId} size={52} glow />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-black leading-tight text-white">
                The ten guardian realms
              </h2>
              <p className="mt-0.5 font-sans text-xs font-semibold text-white/60">
                Free on-chain adventure
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className="font-display text-2xl font-black leading-none"
                style={{ color: STAR_GOLD }}
              >
                {totalStars}
              </p>
              <p className="mt-1 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                / 300 ★
              </p>
            </div>
          </div>
          <p className="mt-3 font-sans text-xs leading-relaxed text-white/55">
            Campaign is free and never affects Arcade prizes.
          </p>
        </motion.section>

        {isLoading ? (
          <p className="py-12 text-center font-sans text-sm font-semibold text-white/50">
            Loading realms…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {zones.map((zone, index) => {
              const themeId = getThemeId(zone.themeId ?? zone.zoneId);
              const images = getThemeImages(themeId);
              const accent = getThemeColors(themeId).accent;
              const guardian = getZoneGuardian(zone.zoneId);
              return (
                <motion.button
                  key={zone.zoneId}
                  type="button"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.025 }}
                  disabled={!zone.unlocked}
                  onClick={() => openZone(zone.zoneId)}
                  className="group relative min-h-[9.5rem] overflow-hidden rounded-3xl border text-left transition disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: zone.unlocked ? `${accent}55` : "rgba(255,255,255,0.08)",
                    boxShadow: zone.unlocked
                      ? `0 4px 24px rgba(0,0,0,0.28), inset 0 1px 0 ${accent}18`
                      : undefined,
                  }}
                >
                  {/* Painted zone art — glass reveals it (never an opaque black fill). */}
                  <img
                    src={images.themeIcon}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ opacity: zone.unlocked ? 0.72 : 0.32 }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,18,0.32)_0%,rgba(2,6,18,0.55)_52%,rgba(2,5,13,0.85)_100%)]" />

                  <div className="relative z-10 flex h-full min-h-[9.5rem] flex-col justify-between p-3">
                    <div className="flex items-start justify-between">
                      {zone.unlocked ? (
                        <img
                          src={getGuardianPortrait(zone.zoneId)}
                          alt={guardian.name}
                          draggable={false}
                          className="h-10 w-10 rounded-xl object-cover"
                          style={{
                            border: `1.5px solid ${accent}66`,
                            boxShadow: `0 0 12px ${accent}33`,
                          }}
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 backdrop-blur-md">
                          <LockKeyhole size={16} className="text-white/55" />
                        </span>
                      )}
                      {zone.cleared && (
                        <span
                          className="rounded-full px-2 py-0.5 font-sans text-[8px] font-black uppercase tracking-wide"
                          style={{
                            color: accent,
                            background: `${accent}22`,
                            border: `1px solid ${accent}44`,
                          }}
                        >
                          Cleared
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-black leading-tight text-white">
                        {zone.name}
                      </p>
                      {zone.unlocked ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span
                            className="inline-flex items-center gap-1 font-sans text-xs font-black"
                            style={{ color: STAR_GOLD }}
                          >
                            <Star size={11} fill={STAR_GOLD} strokeWidth={0} />
                            {zone.stars}/{zone.maxStars}
                          </span>
                          <ChevronRight size={16} className="text-white/60" />
                        </div>
                      ) : (
                        <p className="mt-1 truncate font-sans text-[11px] font-semibold text-white/50">
                          Clear previous guardian
                        </p>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {activeRun && (
        <div className="relative z-20 px-4 pb-3">
          <ArcadeButton onClick={() => navigate("play", activeRun.gameId)}>
            Resume Campaign · Realm {activeRun.zoneId}, Level {activeRun.level}
          </ArcadeButton>
        </div>
      )}
    </div>
  );
}
