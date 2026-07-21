import { useEffect } from "react";
import { ChevronRight, LockKeyhole, Map as MapIcon } from "lucide-react";
import { motion } from "motion/react";

import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import useAccount from "@/hooks/useAccount";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import PageHeader from "@/ui/components/shared/PageHeader";

/** Campaign is an intentionally separate, map-first visual mode. */
export default function CampaignPage() {
  const { address } = useAccount();
  const { zones, totalStars, isLoading } = useZoneProgress(address);
  const activeRun = useActiveStoryAttempt();
  const navigate = useNavigationStore((state) => state.navigate);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const { setMusicMood } = useMusicPlayer();

  useEffect(() => setMusicMood("menu"), [setMusicMood]);

  const openZone = (zoneId: number) => {
    setMapZoneId(zoneId);
    navigate("map");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#110b07] pb-[100px] pt-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_48%),linear-gradient(180deg,#1b1009,#070504)]" />
      <div className="relative z-10">
        <PageHeader title="Campaign" />
      </div>
      <div className="relative z-10 mx-4 min-h-0 flex-1 overflow-y-auto pb-4 hide-scrollbar">
        <section className="mb-4 rounded-3xl border border-amber-200/20 bg-amber-950/30 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <MapIcon className="text-amber-200" />
            <div>
              <p className="font-display text-lg font-black text-amber-50">The ten guardian realms</p>
              <p className="mt-0.5 text-xs font-semibold text-amber-100/55">
                Free on-chain adventure · {totalStars}/300 stars
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-amber-50/55">
            Campaign completion stays here. It does not affect Arcade XP, quests, titles, ranks, or prizes.
          </p>
        </section>

        {isLoading ? (
          <p className="py-12 text-center text-sm font-semibold text-white/50">Loading realms…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {zones.map((zone, index) => {
              const themeId = getThemeId(zone.themeId ?? zone.zoneId);
              const images = getThemeImages(themeId);
              const colors = getThemeColors(themeId);
              return (
                <motion.button
                  key={zone.zoneId}
                  type="button"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.025 }}
                  disabled={!zone.unlocked}
                  onClick={() => openZone(zone.zoneId)}
                  className="relative min-h-40 overflow-hidden rounded-3xl border text-left disabled:opacity-45"
                  style={{ borderColor: `${colors.accent}50` }}
                >
                  <img src={images.themeIcon} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-sans text-sm font-black text-white">{zone.name}</p>
                        <p className="mt-1 text-[11px] font-bold" style={{ color: colors.accent }}>
                          {zone.unlocked ? `${zone.stars}/${zone.maxStars} ★` : "Locked"}
                        </p>
                      </div>
                      {zone.unlocked ? <ChevronRight size={17} className="text-white/65" /> : <LockKeyhole size={16} className="text-white/55" />}
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
          <ArcadeButton
            onClick={() => navigate("play", activeRun.gameId)}
            accentOverride="#f59e0b"
          >
            Resume Campaign · Realm {activeRun.zoneId}, Level {activeRun.level}
          </ArcadeButton>
        </div>
      )}
    </div>
  );
}
