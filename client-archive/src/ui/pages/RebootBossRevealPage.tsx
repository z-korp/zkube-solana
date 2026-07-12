import { useEffect } from "react";
import { ChevronLeft, Crown, Star } from "lucide-react";
import { motion } from "motion/react";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

export default function RebootBossRevealPage() {
  const { playSfx } = useMusicPlayer();
  useEffect(() => {
    playSfx("boss-intro");
  }, [playSfx]);
  const zone = useNavigationStore((state) => state.mapZoneId);
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const setPreviewLevel = useNavigationStore(
    (state) => state.setPendingPreviewLevel,
  );
  const campaign = useRebootCampaign();
  const guardian = getZoneGuardian(zone);
  const themeId = getThemeId(zone);
  const colors = getThemeColors(themeId);
  const images = getThemeImages(themeId);
  const stars =
    campaign.campaign?.maps.find((map) => map.mapId === zone)?.levelStars[9] ??
    0;
  const play = () => {
    setPreviewLevel(10);
    navigate("solana");
  };
  return (
    <div
      className="relative flex min-h-full flex-col overflow-hidden pb-24 text-white"
      style={{ backgroundColor: colors.background }}
    >
      <img
        src={images.background}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,transparent,rgba(0,0,0,.88))]" />
      <button
        onClick={goBack}
        className="absolute left-4 top-5 z-20 rounded-full border border-white/15 bg-black/40 p-2"
      >
        <ChevronLeft />
      </button>
      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-5xl items-center gap-4 px-6 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <p
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.35em]"
            style={{ color: colors.accent }}
          >
            <Crown size={16} /> Guardian trial
          </p>
          <h1 className="mt-3 font-display text-5xl font-black">
            {guardian.name}
          </h1>
          <p
            className="mt-1 text-xl font-bold"
            style={{ color: colors.accent }}
          >
            {guardian.title}
          </p>
          <blockquote
            className="my-6 border-l-2 pl-4 text-lg italic leading-8 text-white/70"
            style={{ borderColor: colors.accent }}
          >
            “{guardian.trialIntro}”
          </blockquote>
          <div className="mb-5 flex gap-1 text-yellow-300">
            {Array.from({ length: 3 }, (_, index) => (
              <Star
                key={index}
                fill={index < stars ? "currentColor" : "none"}
              />
            ))}
          </div>
          <ArcadeButton onClick={play} disabled={campaign.loading}>
            Face {guardian.name}
          </ArcadeButton>
        </motion.div>
        <motion.img
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", damping: 18 }}
          src={getGuardianPortrait(zone)}
          alt={guardian.name}
          className="mx-auto max-h-[70vh] w-auto object-contain drop-shadow-[0_30px_50px_rgba(0,0,0,.8)]"
        />
      </main>
    </div>
  );
}
