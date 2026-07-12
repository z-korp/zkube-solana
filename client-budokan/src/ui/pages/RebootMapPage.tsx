import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Lock, Star } from "lucide-react";
import { motion } from "motion/react";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";
import {
  getMapPathTheme,
  getThemeColors,
  getThemeId,
  getThemeImages,
} from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import { useMapLayout } from "@/hooks/useMapLayout";
import { ZONE_NAMES } from "@/config/profileData";
import type { CampaignMapView } from "@/solana/reboot/campaignClient";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import GuardianGreeting from "@/ui/components/map/GuardianGreeting";
import RebootLevelPreview from "@/ui/components/map/RebootLevelPreview";
import { ZoneBackground } from "@/ui/components/map/ZoneBackground";

// A brand-new career has no on-chain CampaignProgress yet — the first
// sponsored Map 1 run initializes it. Render Map 1 as playable so the
// player can actually take that first step.
const UNINITIALIZED_MAP_1: CampaignMapView = {
  mapId: 1,
  themeId: 1,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 0n,
  usdcCost: 0n,
  levelStars: Array.from({ length: 10 }, () => 0),
  levels: [],
};

const VB_W = 60;
const VB_H = 100;
const NODES_PER_ZONE = 10;
// Purely visual layout randomness — any stable constant works.
const LAYOUT_SEED = 1337;

type NodeState = "locked" | "available" | "current" | "cleared";

const STATE_COLORS: Record<NodeState, { border: string; alpha: number }> = {
  locked: { border: "#475569", alpha: 0.5 },
  cleared: { border: "#22c55e", alpha: 1 },
  current: { border: "#3b82f6", alpha: 1 },
  available: { border: "#f97316", alpha: 1 },
};

const getPathType = (
  fromState: NodeState,
  toState: NodeState,
): "cleared" | "active" | "locked" => {
  if (fromState === "cleared" && toState === "cleared") return "cleared";
  if (
    fromState === "cleared" &&
    (toState === "current" || toState === "available")
  ) {
    return "active";
  }
  return "locked";
};

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
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [showGreeting, setShowGreeting] = useState(false);
  const map =
    campaign.campaign?.maps.find((entry) => entry.mapId === zone) ??
    (!campaign.loading && !campaign.campaign && zone === 1
      ? UNINITIALIZED_MAP_1
      : undefined);
  const guardian = getZoneGuardian(zone);
  const themeId = getThemeId(zone);
  const colors = getThemeColors(themeId);
  const themeImages = getThemeImages(themeId);
  const pathTheme = getMapPathTheme(themeId);
  const stars = map?.levelStars.reduce((sum, value) => sum + value, 0) ?? 0;

  useEffect(() => setMapZoneId(zone), [setMapZoneId, zone]);
  useEffect(() => setSelectedLevel(null), [zone]);

  const { setMusicPlaylist } = useMusicPlayer();
  useEffect(() => {
    setMusicPlaylist(["main", "level"]);
  }, [setMusicPlaylist]);

  const layouts = useMapLayout({
    seed: LAYOUT_SEED,
    totalZones: 10,
    nodesPerZone: NODES_PER_ZONE,
  });
  const layout = layouts[zone - 1];

  const firstPlayable = useMemo(() => {
    if (!map) return 1;
    const uncleared = map.levelStars.findIndex((value) => value === 0);
    return uncleared < 0 ? 10 : uncleared + 1;
  }, [map]);

  const nodeState = (levelIndex: number): NodeState => {
    if (!map || !map.unlocked) return "locked";
    if (map.levelStars[levelIndex] > 0) return "cleared";
    const reachable =
      levelIndex === 0 || map.levelStars[levelIndex - 1] > 0;
    if (!reachable) return "locked";
    return levelIndex + 1 === firstPlayable ? "current" : "available";
  };

  const play = (level: number) => {
    setMapZoneId(zone);
    setPreviewLevel(level);
    setDaily(false);
    navigate(level === 10 ? "boss" : "solana");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-24 text-white">
      <ZoneBackground zone={zone} themeId={themeId} />
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
            {zone}. {ZONE_NAMES[zone]}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-yellow-300/20 bg-black/35 px-3 py-2 text-sm font-black text-yellow-300">
          <Star size={14} fill="currentColor" />
          {stars}/30
        </div>
      </header>

      <div className="relative z-20 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
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

      {campaign.loading && (
        <p className="relative z-10 animate-pulse pt-10 text-center text-white/55">
          Loading on-chain campaign…
        </p>
      )}
      {!campaign.loading && !campaign.campaign && zone !== 1 && (
        <p className="relative z-10 pt-10 text-center text-white/55">
          Start Map 1 to initialize this zKube career.
        </p>
      )}

      {/* Node map */}
      {map && map.unlocked && (
        <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
          <div className="relative mx-auto h-full w-full max-w-[540px]">
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0 h-full w-full transition-opacity duration-300"
              style={{ opacity: showGreeting || selectedLevel ? 0.3 : 1 }}
            >
              {/* Paths */}
              {layout.edges.map((edge) => {
                const fromPt = layout.points[edge.from];
                const toPt = layout.points[edge.to];
                if (!fromPt || !toPt) return null;

                const fromX = fromPt.x * VB_W;
                const fromY = fromPt.y * VB_H;
                const toX = toPt.x * VB_W;
                const toY = toPt.y * VB_H;
                const midY = (fromY + toY) / 2;
                const d = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;

                const pathType = getPathType(
                  nodeState(edge.from),
                  nodeState(edge.to),
                );
                const stroke =
                  pathType === "cleared"
                    ? pathTheme.clearedColor
                    : pathType === "active"
                      ? pathTheme.activeColor
                      : pathTheme.lockedColor;
                const sw =
                  pathType === "locked"
                    ? pathTheme.lockedStrokeWidth
                    : pathTheme.strokeWidth;
                const opacity = pathType === "locked" ? 0.5 : 0.85;
                const dash =
                  pathType === "locked"
                    ? pathTheme.lockedDash
                    : pathTheme.pathStyle === "dashed"
                      ? "8 4"
                      : pathTheme.pathStyle === "dotted"
                        ? "2 3"
                        : undefined;

                return (
                  <g key={`path-${edge.from}-${edge.to}`}>
                    {pathTheme.pathStyle === "double" && (
                      <motion.path
                        d={d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={sw + 1.6}
                        strokeLinecap="round"
                        initial={!dash ? { pathLength: 0 } : undefined}
                        animate={!dash ? { pathLength: 1 } : undefined}
                        transition={{
                          delay: 0.3 + edge.from * 0.05,
                          duration: 0.5,
                          ease: "easeInOut",
                        }}
                        opacity={opacity * 0.35}
                      />
                    )}
                    <motion.path
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={sw}
                      strokeLinecap="round"
                      initial={!dash ? { pathLength: 0 } : undefined}
                      animate={!dash ? { pathLength: 1 } : undefined}
                      transition={{
                        delay: 0.3 + edge.from * 0.05,
                        duration: 0.5,
                        ease: "easeInOut",
                      }}
                      opacity={opacity}
                      strokeDasharray={dash}
                    />
                  </g>
                );
              })}

              {/* Guardian node — bottom-right, aligned with level 1 */}
              {(() => {
                const level1Pt = layout.points[0];
                const guardianX = 0.82 * VB_W;
                const guardianY = level1Pt ? level1Pt.y * VB_H : 0.92 * VB_H;
                const gr = 5;
                const badgeR = 2;
                const badgeX = guardianX + gr * 0.7;
                const badgeY = guardianY + gr * 0.7;
                return (
                  <g
                    onClick={() => setShowGreeting(true)}
                    className="map-guardian-pulse"
                    style={{
                      cursor: "pointer",
                      transformOrigin: `${guardianX}px ${guardianY}px`,
                    }}
                  >
                    <clipPath id="guardian-clip">
                      <circle cx={guardianX} cy={guardianY} r={gr} />
                    </clipPath>
                    <image
                      href={getGuardianPortrait(zone)}
                      x={guardianX - gr}
                      y={guardianY - gr}
                      width={gr * 2}
                      height={gr * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath="url(#guardian-clip)"
                    />
                    <circle
                      cx={guardianX}
                      cy={guardianY}
                      r={gr}
                      fill="none"
                      stroke={colors.accent}
                      strokeWidth={0.6}
                    />
                    <circle cx={badgeX} cy={badgeY} r={badgeR} fill={colors.accent} />
                    <text
                      x={badgeX}
                      y={badgeY + 0.2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0a1628"
                      fontSize={2.4}
                      fontWeight="bold"
                      fontFamily="Outfit, sans-serif"
                    >
                      ?
                    </text>
                    <text
                      x={guardianX}
                      y={guardianY + gr + 2.5}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={colors.accent}
                      fontSize={2}
                      fontWeight="bold"
                      fontFamily="Outfit, sans-serif"
                    >
                      {guardian.name}
                    </text>
                  </g>
                );
              })()}

              {/* Level nodes */}
              {Array.from({ length: NODES_PER_ZONE }, (_, index) => {
                const pt = layout.points[index];
                if (!pt) return null;
                const level = index + 1;
                const boss = level === 10;
                const state = nodeState(index);
                const stateColors = STATE_COLORS[state];
                const isInteractive = state !== "locked";
                const levelStars = map.levelStars[index];

                const cx = pt.x * VB_W;
                const cy = pt.y * VB_H;
                const nodeImg = boss
                  ? themeImages.mapNodeBoss
                  : state === "cleared"
                    ? themeImages.mapNodeCompleted
                    : themeImages.mapNodeLevel;
                const r = boss ? 7.5 : 5;
                const label =
                  state === "cleared" ? "✓" : boss ? "★" : String(level);

                return (
                  <motion.g
                    key={`node-${index}`}
                    onClick={() => {
                      if (!isInteractive) return;
                      setSelectedLevel(level);
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: stateColors.alpha }}
                    transition={{
                      delay: index * 0.06,
                      type: "spring",
                      stiffness: 260,
                      damping: 20,
                    }}
                    style={{
                      cursor: isInteractive ? "pointer" : "default",
                      transformOrigin: `${cx}px ${cy}px`,
                    }}
                  >
                    <clipPath id={`node-clip-${index}`}>
                      <circle cx={cx} cy={cy} r={r} />
                    </clipPath>
                    <image
                      href={nodeImg}
                      x={cx - r}
                      y={cy - r}
                      width={r * 2}
                      height={r * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#node-clip-${index})`}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={
                        state === "current" ? colors.accent : stateColors.border
                      }
                      strokeWidth={state === "current" ? 1 : boss ? 0.6 : 0.4}
                    />

                    {state === "current" && (
                      <>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 2.5}
                          fill={colors.accent}
                          className="map-playing-glow"
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 1.8}
                          fill="none"
                          stroke={colors.accent}
                          strokeWidth={1}
                          className="map-playing-ring"
                          style={{ transformOrigin: `${cx}px ${cy}px` }}
                        />
                      </>
                    )}

                    <circle
                      cx={cx + r * 0.7}
                      cy={cy + r * 0.7}
                      r={2}
                      fill="rgba(0,0,0,0.75)"
                      stroke={stateColors.border}
                      strokeWidth={0.3}
                    />
                    <text
                      x={cx + r * 0.7}
                      y={cy + r * 0.7 + 0.1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize={2.2}
                      fontWeight="bold"
                      fontFamily="Outfit, sans-serif"
                    >
                      {label}
                    </text>

                    {!boss && state !== "locked" && (
                      <g>
                        {[0, 1, 2].map((starIndex) => (
                          <text
                            key={starIndex}
                            fill={
                              levelStars > starIndex
                                ? "#FACC15"
                                : "rgba(255,255,255,0.3)"
                            }
                            x={cx - 2.5 + starIndex * 2.5}
                            y={cy + r + 2.5}
                            fontSize={2}
                            textAnchor="middle"
                          >
                            ★
                          </text>
                        ))}
                      </g>
                    )}
                  </motion.g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Locked-map unlock panel */}
      {map && !map.unlocked && (
        <div className="relative z-10 mx-auto w-full max-w-md flex-1 px-4 pt-8">
          <div className="space-y-3 rounded-2xl border border-yellow-300/20 bg-yellow-950/40 p-5 text-center backdrop-blur">
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
                {map.starCost.toString()} Stars
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
        </div>
      )}

      {campaign.error && (
        <p className="relative z-10 pb-2 text-center text-xs text-red-300">
          {campaign.error}
        </p>
      )}

      {selectedLevel !== null && map && (
        <RebootLevelPreview
          zoneId={zone}
          level={selectedLevel}
          rules={map.levels[selectedLevel - 1] ?? null}
          stars={map.levelStars[selectedLevel - 1] ?? 0}
          isBoss={selectedLevel === 10}
          cleared={(map.levelStars[selectedLevel - 1] ?? 0) > 0}
          colors={colors}
          onPlay={() => play(selectedLevel)}
          onClose={() => setSelectedLevel(null)}
        />
      )}

      {showGreeting && (
        <GuardianGreeting
          colors={colors}
          guardian={guardian}
          mode="story"
          activeMutatorId={map?.levels[firstPlayable - 1]?.activeMutatorId}
          passiveMutatorId={map?.levels[firstPlayable - 1]?.passiveMutatorId}
          bossCleared={(map?.levelStars[9] ?? 0) > 0}
          onClose={() => setShowGreeting(false)}
        />
      )}
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
