import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Info } from "lucide-react";
import { motion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { ZONE_NAMES } from "@/config/profileData";
import {
  getMapPathTheme,
  getThemeColors,
  getThemeId,
  getThemeImages,
} from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useMusicPlayer } from "@/contexts/hooks";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useGame } from "@/hooks/useGame";
import { useGameLevel } from "@/hooks/useGameLevel";
import {
  NODES_PER_ZONE,
  useMapData,
  type MapNodeData,
  type NodeState,
} from "@/hooks/useMapData";
import { useMapLayout } from "@/hooks/useMapLayout";
import { useCampaignLauncher } from "@/play/useCampaignLauncher";
import { useNavigationStore } from "@/stores/navigationStore";
import LevelCompleteDialog from "@/ui/components/LevelCompleteDialog";
import GuardianGreeting from "@/ui/components/map/GuardianGreeting";
import LevelPreview from "@/ui/components/map/LevelPreview";
import ZoneBackground from "@/ui/components/map/ZoneBackground";
import {
  resolveCampaignMap,
  unavailableMap,
} from "@/ui/components/map/mapLogic";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/elements/tooltip";
import { highestClearedLevel } from "@/utils/solanaDisplay";
import { showToast } from "@/utils/toast";

const VB_W = 60;
const VB_H = 100;

const STATE_COLORS: Record<
  NodeState,
  { fill: string; border: string; alpha: number; text: string }
> = {
  locked: { fill: "#334155", border: "#475569", alpha: 0.5, text: "#94a3b8" },
  cleared: { fill: "#14532d", border: "#22c55e", alpha: 1, text: "#bbf7d0" },
  current: { fill: "#0f2743", border: "#3b82f6", alpha: 1, text: "#bfdbfe" },
  available: { fill: "#1e293b", border: "#f97316", alpha: 1, text: "#fed7aa" },
  visited: { fill: "#1e3a2f", border: "#4ade80", alpha: 0.85, text: "#bbf7d0" },
  playing: { fill: "#7c2d12", border: "#fb923c", alpha: 1, text: "#ffedd5" },
};

const canOpenPreview = (node: MapNodeData): boolean => node.state !== "locked";

const getPathType = (
  fromState: NodeState,
  toState: NodeState,
): "cleared" | "active" | "locked" => {
  if (
    fromState === "cleared" &&
    (toState === "cleared" || toState === "visited")
  ) {
    return "cleared";
  }
  if (
    fromState === "cleared" &&
    (toState === "current" || toState === "available" || toState === "playing")
  ) {
    return "active";
  }
  return "locked";
};

const getLabel = (node: MapNodeData): string => {
  if (node.state === "playing") return "▶";
  if (node.type === "boss") return node.state === "cleared" ? "✓" : "★";
  if (node.state === "cleared") return "✓";
  return String(node.contractLevel);
};

const MapPage: React.FC = () => {
  const campaign = useCampaign();
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const gameId = useNavigationStore((state) => state.gameId);
  const rawMapZoneId = useNavigationStore((state) => state.mapZoneId);
  const mapZoneId = Math.min(10, Math.max(1, rawMapZoneId));
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const pendingLevelCompletion = useNavigationStore(
    (state) => state.pendingLevelCompletion,
  );
  const setPendingLevelCompletion = useNavigationStore(
    (state) => state.setPendingLevelCompletion,
  );
  const greetedZones = useNavigationStore((state) => state.greetedZones);
  const markZoneGreeted = useNavigationStore((state) => state.markZoneGreeted);
  const { setThemeTemplate } = useTheme();
  const { setMusicMood, warmMusic } = useMusicPlayer();

  const map = resolveCampaignMap(
    campaign.campaign?.maps ?? null,
    mapZoneId,
    campaign.loading,
  );
  const mapForData = useMemo(
    () => map ?? unavailableMap(mapZoneId),
    [map, mapZoneId],
  );
  const activeStoryRun = useActiveStoryAttempt();
  const activeNode = activeStoryRun
    ? { zoneId: activeStoryRun.zoneId, level: activeStoryRun.level }
    : null;
  const mapData = useMapData({ map: mapForData, activeStoryNode: activeNode });

  const { game } = useGame({
    gameId: gameId ?? undefined,
    shouldLog: false,
  });
  const gameLevel = useGameLevel({ gameId: game?.id });

  // Layout randomness is visual-only; gameplay rules come from the catalog.
  const layoutSeed = mapZoneId * 48_271 + 12_347;
  const zoneLayouts = useMapLayout({
    seed: layoutSeed,
    totalZones: 1,
    nodesPerZone: NODES_PER_ZONE,
  });

  const [selectedNode, setSelectedNode] = useState<MapNodeData | null>(null);
  const [showGreeting, setShowGreeting] = useState(false);
  const guardian = getZoneGuardian(mapZoneId);
  const { starting: launching, startLevel } = useCampaignLauncher();

  useEffect(() => {
    if (rawMapZoneId !== mapZoneId) setMapZoneId(mapZoneId);
  }, [mapZoneId, rawMapZoneId, setMapZoneId]);

  useEffect(() => {
    setMusicMood("menu");
  }, [setMusicMood]);

  // Preview a boss node → warm its track so the fight's music starts instantly
  // once the run launches in place (no separate reveal screen loads it first).
  useEffect(() => {
    if (selectedNode?.type === "boss") warmMusic(["boss"]);
  }, [selectedNode?.type, warmMusic]);

  const themeId = getThemeId(map?.themeId ?? mapZoneId);
  useEffect(() => {
    setThemeTemplate(themeId);
  }, [setThemeTemplate, themeId]);

  const handlePlay = () => {
    if (!selectedNode) return;
    const level = selectedNode.contractLevel;

    if (activeStoryRun) {
      const isPlayingNode =
        selectedNode.zone === activeStoryRun.zoneId &&
        level === activeStoryRun.level;
      if (isPlayingNode) {
        setSelectedNode(null);
        navigate("play", activeStoryRun.gameId);
        return;
      }
      showToast({
        message: `Run in progress on Zone ${activeStoryRun.zoneId}, Level ${activeStoryRun.level}.`,
        type: "error",
      });
      return;
    }

    setMapZoneId(mapZoneId);
    // Launch in place — boss levels included. The preview card already shows
    // the full guardian trial (constraints, star tiers), so there is no
    // separate reveal step; the Play button shows "Preparing…" and navigation
    // happens once the run is live.
    void startLevel(mapZoneId, level);
  };

  const colors = getThemeColors(themeId);
  const themeImages = getThemeImages(themeId);
  const pathTheme = getMapPathTheme(themeId);
  const layout = zoneLayouts[0];
  const nodes = mapData.nodes;
  const zoneName = ZONE_NAMES[mapZoneId] ?? `Zone ${mapZoneId}`;
  const zoneStars = map?.levelStars.reduce((sum, stars) => sum + stars, 0) ?? 0;
  const storyHighestCleared = map?.cleared
    ? 10
    : highestClearedLevel(map?.levelStars ?? []);
  const isFirstVisit =
    map !== undefined &&
    map.unlocked &&
    zoneStars === 0 &&
    storyHighestCleared === 0;
  const alreadyGreeted = greetedZones.has(mapZoneId);
  const [dataStabilized, setDataStabilized] = useState(false);

  useEffect(() => {
    setDataStabilized(false);
    const timer = window.setTimeout(() => setDataStabilized(true), 1500);
    return () => window.clearTimeout(timer);
  }, [mapZoneId]);

  useEffect(() => {
    if (map !== undefined) setDataStabilized(true);
  }, [map]);

  useEffect(() => {
    if (
      !dataStabilized ||
      alreadyGreeted ||
      pendingLevelCompletion ||
      !map?.unlocked
    ) {
      return;
    }
    if (isFirstVisit) {
      setShowGreeting(true);
      markZoneGreeted(mapZoneId);
    }
  }, [
    alreadyGreeted,
    dataStabilized,
    isFirstVisit,
    map?.unlocked,
    mapZoneId,
    markZoneGreeted,
    pendingLevelCompletion,
  ]);

  const firstPlayable = useMemo(() => {
    if (!map) return 1;
    const firstUncleared = map.levelStars.findIndex((stars) => stars === 0);
    return firstUncleared < 0 ? 10 : firstUncleared + 1;
  }, [map]);

  return (
    <div className="relative flex h-full flex-col">
      <ZoneBackground zone={mapZoneId} themeId={themeId} />

      {/* Floating overlay: back + zone name + stars + info */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-[clamp(12px,3vw,20px)] pb-1 pt-[clamp(12px,3vw,20px)]"
      >
        {/* Left: back + zone name */}
        <div className="pointer-events-auto flex items-center gap-[clamp(6px,1.5vw,12px)]">
          <button
            onClick={goBack}
            className="flex h-[clamp(32px,7vw,44px)] w-[clamp(32px,7vw,44px)] shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/30 backdrop-blur-md"
            style={{ color: colors.accent }}
          >
            <ChevronLeft className="h-[50%] w-[50%]" />
          </button>
          <span className="font-display text-[clamp(18px,4.5vw,28px)] font-black text-white drop-shadow-md">
            {zoneName}
          </span>
        </div>

        {/* Right: stars + perfect-reward infotip */}
        <div className="pointer-events-auto">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5"
                  aria-label="Zone completion reward"
                >
                  <span
                    className="font-display text-[clamp(14px,3.5vw,22px)] font-black drop-shadow-md"
                    style={{ color: colors.accent }}
                  >
                    {zoneStars}/30 ★
                  </span>
                  <Info className="h-[clamp(12px,3vw,16px)] w-[clamp(12px,3vw,16px)] text-white/60" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-[220px] bg-slate-900 border border-slate-500 px-3 py-2 font-sans text-[11px] text-white shadow-lg"
              >
                {map?.perfected
                  ? "Perfect reward earned"
                  : "Clear all 30 stars: +20★ + 300 XP"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </motion.div>

      {/* Map SVG */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="relative mx-auto h-full w-full max-w-[540px]">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full transition-opacity duration-300"
            style={{ opacity: showGreeting || selectedNode ? 0.3 : 1 }}
          >
            {/* Paths */}
            {layout?.edges.map((edge) => {
              const fromPt = layout.points[edge.from];
              const toPt = layout.points[edge.to];
              if (!fromPt || !toPt) return null;

              const fromX = fromPt.x * VB_W;
              const fromY = fromPt.y * VB_H;
              const toX = toPt.x * VB_W;
              const toY = toPt.y * VB_H;
              const midY = (fromY + toY) / 2;
              const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;

              const fromNode = nodes[edge.from];
              const toNode = nodes[edge.to];
              if (!fromNode || !toNode) return null;
              const pathType = getPathType(fromNode.state, toNode.state);
              const stroke =
                pathType === "cleared"
                  ? pathTheme.clearedColor
                  : pathType === "active"
                    ? pathTheme.activeColor
                    : pathTheme.lockedColor;
              const strokeWidth =
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
                      d={path}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeWidth + 1.6}
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
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
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

            {/* Guardian node — bottom-right, aligned with level 1, loads first */}
            {(() => {
              const level1Pt = layout?.points[0];
              const guardianX = 0.82 * VB_W;
              const guardianY = level1Pt ? level1Pt.y * VB_H : 0.92 * VB_H;
              const radius = 5;
              const badgeRadius = 2;
              const badgeX = guardianX + radius * 0.7;
              const badgeY = guardianY + radius * 0.7;
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
                    <circle cx={guardianX} cy={guardianY} r={radius} />
                  </clipPath>
                  <image
                    href={getGuardianPortrait(mapZoneId)}
                    x={guardianX - radius}
                    y={guardianY - radius}
                    width={radius * 2}
                    height={radius * 2}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath="url(#guardian-clip)"
                  />
                  <circle
                    cx={guardianX}
                    cy={guardianY}
                    r={radius}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={0.6}
                  />
                  <circle
                    cx={badgeX}
                    cy={badgeY}
                    r={badgeRadius}
                    fill={colors.accent}
                  />
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
                    y={guardianY + radius + 2.5}
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
            {nodes.map((node) => {
              const point = layout?.points[node.nodeInZone];
              if (!point) return null;

              const cx = point.x * VB_W;
              const cy = point.y * VB_H;
              const stateColors = STATE_COLORS[node.state];
              const isPlayingNode =
                activeStoryRun !== null &&
                node.zone === activeStoryRun.zoneId &&
                node.contractLevel === activeStoryRun.level;
              const blockedByActiveRun =
                activeStoryRun !== null && !isPlayingNode;
              const isInteractive =
                node.state !== "locked" && !blockedByActiveRun;
              const label = getLabel(node);
              const isCleared =
                node.state === "cleared" || node.state === "visited";
              const nodeImage =
                node.type === "boss"
                  ? themeImages.mapNodeBoss
                  : isCleared
                    ? themeImages.mapNodeCompleted
                    : themeImages.mapNodeLevel;
              const radius = node.type === "boss" ? 7.5 : 5;

              return (
                <motion.g
                  key={`node-${node.nodeInZone}`}
                  onClick={() => {
                    if (activeStoryRun && !isPlayingNode) {
                      showToast({
                        message: `Run in progress on Zone ${activeStoryRun.zoneId}, Level ${activeStoryRun.level}.`,
                        type: "error",
                      });
                      return;
                    }
                    if (activeStoryRun && isPlayingNode) {
                      navigate("play", activeStoryRun.gameId);
                      return;
                    }
                    if (!isInteractive) return;
                    if (canOpenPreview(node)) setSelectedNode(node);
                  }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: stateColors.alpha }}
                  transition={{
                    delay: node.nodeInZone * 0.06,
                    type: "spring",
                    stiffness: 260,
                    damping: 20,
                  }}
                  style={{
                    cursor: isInteractive ? "pointer" : "default",
                    transformOrigin: `${cx}px ${cy}px`,
                  }}
                >
                  <clipPath id={`node-clip-${node.nodeInZone}`}>
                    <circle cx={cx} cy={cy} r={radius} />
                  </clipPath>
                  {/* Inner group so the next-playable scale pulse composes
                      with the framer-motion entrance transform on the outer
                      <motion.g> (same pattern as Block.tsx). */}
                  <g
                    className={
                      node.state === "current" ? "map-current-pulse" : undefined
                    }
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                  >
                    <image
                      href={nodeImage}
                      x={cx - radius}
                      y={cy - radius}
                      width={radius * 2}
                      height={radius * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#node-clip-${node.nodeInZone})`}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill="none"
                      stroke={
                        node.state === "playing"
                          ? colors.accent
                          : stateColors.border
                      }
                      strokeWidth={
                        node.state === "playing"
                          ? 1.5
                          : node.type === "boss"
                            ? 0.6
                            : 0.4
                      }
                    />
                  </g>

                  {node.state === "playing" && (
                    <>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius + 2.5}
                        fill={colors.accent}
                        className="map-playing-glow"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius + 1.8}
                        fill="none"
                        stroke={colors.accent}
                        strokeWidth={1}
                        className="map-playing-ring"
                        style={{ transformOrigin: `${cx}px ${cy}px` }}
                      />
                    </>
                  )}

                  <circle
                    cx={cx + radius * 0.7}
                    cy={cy + radius * 0.7}
                    r={2}
                    fill="rgba(0,0,0,0.75)"
                    stroke={stateColors.border}
                    strokeWidth={0.3}
                  />
                  <text
                    x={cx + radius * 0.7}
                    y={cy + radius * 0.7 + 0.1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#ffffff"
                    fontSize={2.2}
                    fontWeight="bold"
                    fontFamily="Outfit, sans-serif"
                  >
                    {label}
                  </text>

                  {node.type === "classic" && node.state !== "locked" && (
                    <g>
                      {[0, 1, 2].map((index) => {
                        const stars =
                          map?.levelStars[node.contractLevel - 1] ?? 0;
                        const starX = cx - 2.5 + index * 2.5;
                        const starY = cy + radius + 2.5;
                        return (
                          <text
                            key={index}
                            fill={
                              stars > index
                                ? "#FACC15"
                                : "rgba(255,255,255,0.3)"
                            }
                            x={starX}
                            y={starY}
                            fontSize={2}
                            textAnchor="middle"
                          >
                            ★
                          </text>
                        );
                      })}
                    </g>
                  )}
                </motion.g>
              );
            })}
          </svg>
        </div>

        {selectedNode && !pendingLevelCompletion && map && (
          <LevelPreview
            node={selectedNode}
            game={game}
            gameLevel={gameLevel}
            zoneId={mapZoneId}
            colors={colors}
            levelStars={map.levelStars}
            starting={launching}
            onPlay={handlePlay}
            onClose={() => {
              if (!launching) setSelectedNode(null);
            }}
          />
        )}

        {pendingLevelCompletion && (
          <LevelCompleteDialog
            isOpen
            onClose={() => {
              // Land on the plain map — no next level pre-selected.
              setPendingLevelCompletion(null);
            }}
            level={pendingLevelCompletion.level}
            levelMoves={pendingLevelCompletion.levelMoves}
            prevTotalScore={pendingLevelCompletion.prevTotalScore}
            totalScore={pendingLevelCompletion.totalScore}
            gameLevel={pendingLevelCompletion.gameLevel}
            xpAwarded={pendingLevelCompletion.xpAwarded}
            zoneId={mapZoneId}
            colors={colors}
            isIncomplete={pendingLevelCompletion.isIncomplete}
          />
        )}

        {showGreeting && (
          <GuardianGreeting
            colors={colors}
            guardian={guardian}
            activeMutatorId={map?.levels[firstPlayable - 1]?.activeMutatorId}
            passiveMutatorId={map?.levels[firstPlayable - 1]?.passiveMutatorId}
            isFirstVisit={isFirstVisit}
            bossCleared={map?.cleared ?? false}
            onClose={() => setShowGreeting(false)}
          />
        )}

        {!map && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-2xl border border-white/20 bg-black/45 px-4 py-3 font-sans text-sm font-semibold text-white/80 backdrop-blur-md">
              {campaign.loading
                ? "Loading map..."
                : "This campaign map is not available."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapPage;
