import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { getThemeId } from "@/config/themes";
import { ZONE_NAMES } from "@/config/profileData";
import { useMusicPlayer } from "@/contexts/hooks";
import useAccount from "@/hooks/useAccount";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  GuardianFaceBlock,
  mixHex,
  MONEY_GOLD,
  PLATE_STYLE,
} from "@/ui/components/economy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import InfoTip from "@/ui/components/shared/InfoTip";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useTheme, useThemeColors } from "@/ui/elements/theme-provider/hooks";

const STAR_GOLD = "#FACC15";

/**
 * A level's three stars as one small block: copper, silver, gold.
 *
 * The old row filled gold at one star or more, so a realm at 10/30 and one at
 * 30/30 drew the same ten gold squares — the pips could say "cleared" but never
 * "what is left here", which is the one thing the 300-star total cannot
 * localise either. The metal answers it per level at a glance.
 */
const STAR_METALS: readonly { face: string; light: string; dark: string }[] = [
  { face: "#C2793A", light: "#E9A867", dark: "#6E3D17" },
  { face: "#C4D2DE", light: "#F2F7FB", dark: "#7A8896" },
  { face: STAR_GOLD, light: "#FDE68A", dark: "#A9760B" },
];

const PIP_SIZE = 13;

function LevelPip({ stars }: { stars: number }) {
  const metal = STAR_METALS[Math.min(3, Math.max(0, stars)) - 1];
  // Unplayed is an empty socket, so the row reads as blocks waiting to be
  // filled rather than as dim blocks.
  return (
    <span
      className="block"
      style={{
        width: PIP_SIZE,
        height: PIP_SIZE,
        borderRadius: 4,
        background: metal
          ? `linear-gradient(180deg, ${metal.light} 0%, ${metal.face} 55%, ${metal.dark} 100%)`
          : "rgba(255,255,255,0.10)",
        boxShadow: metal
          ? "inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 3px rgba(0,0,0,0.5)"
          : "inset 0 1px 2px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.5)",
      }}
    />
  );
}

/**
 * Campaign — the realm IS the screen. One full-bleed painting per realm with
 * the guardian staged directly on it (no card, no nested art): name, level
 * pips, stars, and the one key floating at the bottom. Chunky accent arrows
 * browse the ten realms — locked ones show dark with a locked key, so the
 * road ahead stays visible. The map, previews, greetings and in-run board
 * are untouched.
 */
export default function CampaignPage() {
  const { address } = useAccount();
  const { zones, totalStars, isLoading } = useZoneProgress(address);
  const activeRun = useActiveStoryAttempt();
  const navigate = useNavigationStore((state) => state.navigate);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const { setMusicMood } = useMusicPlayer();
  const { setThemeTemplate } = useTheme();
  // The browse arrows are utility chrome, so they wear the realm's accent —
  // gold stays for stars and the one key below.
  const accent = useThemeColors().accent;
  const arrowUnder = mixHex(accent, 0, 0.55);
  const arrowStyle: React.CSSProperties = {
    background: `linear-gradient(160deg, ${mixHex(accent, 255, 0.42)} 0%, ${accent} 55%, ${mixHex(accent, 0, 0.28)} 100%)`,
    boxShadow: `0 4px 0 ${arrowUnder}, inset 0 2px 0 rgba(255,255,255,0.5)`,
    color: "#0a1628",
  };

  useEffect(() => setMusicMood("menu"), [setMusicMood]);

  // The realm the player is in: the resume run's realm, else the furthest
  // unlocked realm, else the first.
  const currentZoneId = useMemo(() => {
    if (activeRun) return activeRun.zoneId;
    const unlocked = zones.filter((zone) => zone.unlocked);
    if (unlocked.length === 0) return 1;
    return unlocked.reduce((max, zone) => Math.max(max, zone.zoneId), 1);
  }, [activeRun, zones]);

  // The stage shows whichever realm the arrows browse to; it follows the
  // player's own realm until they wander.
  const [selectedZoneId, setSelectedZoneId] = useState(currentZoneId);
  useEffect(() => {
    setSelectedZoneId(currentZoneId);
  }, [currentZoneId]);

  useEffect(() => {
    setThemeTemplate(getThemeId(selectedZoneId), false);
  }, [selectedZoneId, setThemeTemplate]);

  const selectedZone = zones.find((zone) => zone.zoneId === selectedZoneId);
  const guardian = getZoneGuardian(selectedZoneId);
  const unlocked = selectedZone?.unlocked ?? false;
  const perfected =
    selectedZone !== undefined &&
    (selectedZone.perfectionClaimed ||
      selectedZone.stars >= selectedZone.maxStars);
  // Mastery is worn as a corner star; the rim is reserved for ladder rank.
  const mastery = perfected
    ? ("perfected" as const)
    : selectedZone?.bossCleared
      ? ("cleared" as const)
      : null;

  const openZone = (zoneId: number) => {
    setMapZoneId(zoneId);
    navigate("map");
  };

  const resumeHere = activeRun !== null && selectedZoneId === activeRun.zoneId;
  const keyLabel = resumeHere
    ? "Resume"
    : selectedZoneId === currentZoneId
      ? "Continue"
      : "Enter";
  const onKey = () => {
    if (resumeHere && activeRun) {
      navigate("play", activeRun.gameId);
      return;
    }
    openZone(selectedZoneId);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[104px] pt-7">
      {/* ONE background: the realm's own painting, full bleed. */}
      <motion.div
        key={`art-${selectedZoneId}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="absolute inset-0"
      >
        <ZoneBackdrop
          zoneId={selectedZoneId}
          imageOpacity={unlocked ? 0.85 : 0.35}
        />
      </motion.div>

      {/* The crown row, exactly Home's: a plate chip, the display title, and
          one control. The 300-star total was a full-width progress bar under
          the title — a global number wedged above a screen that is otherwise
          about the one realm you are browsing, in a material nothing else in
          the app uses. As a chip it keeps the number and gives the row back. */}
      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center px-4">
        <span
          className="flex items-center gap-1.5 justify-self-start rounded-xl px-2 py-2 font-mono text-xs font-bold tabular-nums text-white"
          style={PLATE_STYLE}
        >
          <span style={{ color: STAR_GOLD }}>★</span>
          {totalStars}/300
        </span>
        <h1
          className="text-center font-display text-[46px] leading-none"
          style={{ color: "#FFF4D7", textShadow: "0 4px 20px rgba(0,0,0,0.7)" }}
        >
          Campaign
        </h1>
        <span className="justify-self-end">
          <InfoTip label="Campaign rules">
            Campaign is free — stars are the only record, and they never affect
            Arcade prizes. Each realm holds ten levels; beat the guardian at
            level 10 to open the next realm. 30/30 stars turns a realm gold.
          </InfoTip>
        </span>
      </div>

      {/* The stage: the guardian directly on the scene, no card. */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-16">
        {isLoading ? (
          <p className="font-sans text-sm font-semibold text-white/50">
            Loading realms…
          </p>
        ) : (
          <motion.div
            key={`stage-${selectedZoneId}`}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28 }}
            className="flex flex-col items-center gap-2.5"
          >
            {unlocked ? (
              <GuardianFaceBlock
                zoneId={selectedZoneId}
                size={148}
                badge={mastery}
                breathe
              />
            ) : (
              <span
                className="grid place-items-center text-white/55"
                style={{
                  width: 148,
                  height: 148,
                  borderRadius: "24%",
                  background:
                    "linear-gradient(135deg, #2A3850 0%, #16202F 100%)",
                  boxShadow:
                    "inset 0 0 0 4px rgba(255,255,255,0.16), 0 10px 26px rgba(0,0,0,0.5)",
                }}
              >
                <LockKeyhole size={42} />
              </span>
            )}
            <span
              className="mt-2 font-sans text-[11px] font-bold uppercase tracking-[0.26em] text-white/60"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
            >
              {ZONE_NAMES[selectedZoneId] ?? ""}
            </span>
            <span
              className={`font-display text-[42px] leading-none ${
                unlocked ? "text-white" : "text-white/60"
              }`}
              style={{ textShadow: "0 3px 14px rgba(0,0,0,0.85)" }}
            >
              {guardian.name}
            </span>
            {unlocked && (
              <>
                <div className="mt-2 flex gap-2">
                  {Array.from({ length: 10 }, (_, index) => (
                    <LevelPip
                      key={index}
                      stars={selectedZone?.levelStars?.[index] ?? 0}
                    />
                  ))}
                </div>
                <span
                  className="mt-1 rounded-full bg-black/55 px-3.5 py-1.5 font-mono text-[14px] font-bold tabular-nums"
                  style={{ color: STAR_GOLD }}
                >
                  ★ {selectedZone?.stars ?? 0}/{selectedZone?.maxStars ?? 30}
                </span>
              </>
            )}
          </motion.div>
        )}

        {/* Chunky accent arrows browse the realms, and the road is a loop:
            realm 10 steps forward to 1. A disabled arrow at either end was a
            dead control on a screen whose whole job is browsing. */}
        <motion.button
          type="button"
          aria-label="Previous realm"
          onClick={() => setSelectedZoneId((zone) => (zone === 1 ? 10 : zone - 1))}
          whileTap={{ y: 2, boxShadow: `0 1px 0 ${arrowUnder}` }}
          className="absolute left-3 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-2xl"
          style={arrowStyle}
        >
          <ChevronLeft size={26} strokeWidth={3} />
        </motion.button>
        <motion.button
          type="button"
          aria-label="Next realm"
          onClick={() => setSelectedZoneId((zone) => (zone === 10 ? 1 : zone + 1))}
          whileTap={{ y: 2, boxShadow: `0 1px 0 ${arrowUnder}` }}
          className="absolute right-3 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-2xl"
          style={arrowStyle}
        >
          <ChevronRight size={26} strokeWidth={3} />
        </motion.button>
      </div>

      {/* Ten dots — where this realm sits on the road. */}
      <div className="relative z-10 flex items-center justify-center gap-2 pb-3">
        {zones.map((zone) => (
          <span
            key={zone.zoneId}
            style={{
              width: zone.zoneId === selectedZoneId ? 9 : 6,
              height: zone.zoneId === selectedZoneId ? 9 : 6,
              borderRadius: 999,
              background:
                zone.zoneId === selectedZoneId
                  ? STAR_GOLD
                  : zone.unlocked
                    ? "rgba(255,255,255,0.6)"
                    : "rgba(255,255,255,0.2)",
            }}
          />
        ))}
      </div>

      {/* The one key, floating at the bottom of the scene. */}
      <div className="relative z-10 px-4">
        {unlocked ? (
          <ArcadeButton onClick={onKey} accentOverride={MONEY_GOLD}>
            {keyLabel}
          </ArcadeButton>
        ) : (
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/[0.12] bg-black/50 px-4 py-4 font-sans text-[17px] font-extrabold uppercase tracking-[0.08em] text-white/40"
          >
            <LockKeyhole size={18} />
            Locked
          </button>
        )}
      </div>
    </div>
  );
}
