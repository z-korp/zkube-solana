import { useMemo } from "react";

import { getThemeId, type ThemeId } from "@/config/themes";
import type { CampaignMapView } from "@/solana/reboot/campaignClient";
import { rulesToGameLevelData, type GameLevelData } from "./useGameLevel";

export type NodeType = "classic" | "boss";
export type NodeState =
  | "locked"
  | "cleared"
  | "current"
  | "available"
  | "visited"
  | "playing";

export interface ActiveStoryNode {
  zoneId: number;
  level: number;
}

export interface MapNodeData {
  nodeIndex: number;
  zone: number;
  nodeInZone: number;
  type: NodeType;
  draftPhase: null;
  contractLevel: number;
  displayLabel: string;
  state: NodeState;
  levelConfig: GameLevelData | null;
  zoneTheme: ThemeId;
}

export interface MapData {
  nodes: MapNodeData[];
  zoneTheme: ThemeId;
  currentNodeIndex: number;
}

export interface UseMapDataParams {
  map: CampaignMapView;
  activeStoryNode?: ActiveStoryNode | null;
}

export const NODES_PER_ZONE = 10;
export const TOTAL_ZONES = 10;
export const GAMEPLAY_LEVELS = 10;

export function contractLevelToNodeIndex(contractLevel: number): number {
  if (contractLevel < 1 || contractLevel > NODES_PER_ZONE) return 0;
  return contractLevel - 1;
}

export function generateMapData({
  map,
  activeStoryNode = null,
}: UseMapDataParams): MapData {
  const zoneTheme = getThemeId(map.themeId);
  const firstUncleared = map.levelStars.findIndex((stars) => stars === 0);
  const currentNodeIndex = firstUncleared < 0 ? 9 : firstUncleared;
  const playable = map.enabled && map.unlocked;

  const nodes = Array.from({ length: NODES_PER_ZONE }, (_, nodeIndex) => {
    const level = nodeIndex + 1;
    const cleared =
      map.levelStars[nodeIndex] > 0 || (map.cleared && level === 10);
    const playing =
      activeStoryNode?.zoneId === map.mapId && activeStoryNode.level === level;
    let state: NodeState = "locked";
    if (playing) state = "playing";
    else if (cleared) state = "cleared";
    else if (playable && nodeIndex === currentNodeIndex) state = "current";

    const rules = map.levels[nodeIndex];
    return {
      nodeIndex,
      zone: map.mapId,
      nodeInZone: nodeIndex,
      type: level === 10 ? ("boss" as const) : ("classic" as const),
      draftPhase: null,
      contractLevel: level,
      displayLabel: level === 10 ? `${map.mapId}-BOSS` : String(level),
      state,
      levelConfig: rules ? rulesToGameLevelData(rules, level) : null,
      zoneTheme,
    };
  });

  return { nodes, zoneTheme, currentNodeIndex };
}

export function useMapData(params: UseMapDataParams): MapData {
  const { map, activeStoryNode } = params;
  return useMemo(
    () => generateMapData({ map, activeStoryNode }),
    [activeStoryNode, map],
  );
}
