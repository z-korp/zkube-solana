import { useMemo } from "react";

interface MapLayoutPoint {
  x: number;
  y: number;
}

interface MapLayoutEdge {
  from: number;
  to: number;
}

export interface ZoneLayout {
  points: MapLayoutPoint[];
  edges: MapLayoutEdge[];
}

export interface UseMapLayoutParams {
  totalZones: number;
  nodesPerZone: number;
}

// The ten Campaign positions are authored furniture. Gameplay does not gain
// anything from rolling and ranking eight cosmetic paths for every realm.
const CAMPAIGN_PATH: readonly MapLayoutPoint[] = [
  { x: 0.5, y: 0.92 },
  { x: 0.28, y: 0.82 },
  { x: 0.68, y: 0.73 },
  { x: 0.31, y: 0.64 },
  { x: 0.7, y: 0.55 },
  { x: 0.26, y: 0.46 },
  { x: 0.64, y: 0.37 },
  { x: 0.3, y: 0.28 },
  { x: 0.72, y: 0.18 },
  { x: 0.5, y: 0.08 },
] as const;

function fixedZoneLayout(nodesPerZone: number): ZoneLayout {
  const points = CAMPAIGN_PATH.slice(0, nodesPerZone).map((point) => ({
    ...point,
  }));
  const edges = Array.from(
    { length: Math.max(0, points.length - 1) },
    (_, from) => ({ from, to: from + 1 }),
  );
  return { points, edges };
}

export function useMapLayout({
  totalZones,
  nodesPerZone,
}: UseMapLayoutParams): ZoneLayout[] {
  return useMemo(
    () =>
      Array.from({ length: totalZones }, () => fixedZoneLayout(nodesPerZone)),
    [nodesPerZone, totalZones],
  );
}
