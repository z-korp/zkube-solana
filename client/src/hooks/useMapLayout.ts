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

// Each realm owns its path as authored map furniture. The coordinates keep a
// node-radius margin at both sides; the page owns the header and dock bands.
export const CAMPAIGN_PATHS: readonly (readonly MapLayoutPoint[])[] = [
  // Tiki — a broad coast-hugging arc.
  [
    { x: 0.18, y: 0.9 },
    { x: 0.36, y: 0.82 },
    { x: 0.59, y: 0.78 },
    { x: 0.8, y: 0.7 },
    { x: 0.7, y: 0.6 },
    { x: 0.48, y: 0.55 },
    { x: 0.25, y: 0.48 },
    { x: 0.18, y: 0.36 },
    { x: 0.4, y: 0.27 },
    { x: 0.66, y: 0.18 },
  ],
  // Egypt — switchbacks up the riverbank.
  [
    { x: 0.76, y: 0.9 },
    { x: 0.52, y: 0.83 },
    { x: 0.25, y: 0.76 },
    { x: 0.2, y: 0.64 },
    { x: 0.47, y: 0.58 },
    { x: 0.78, y: 0.51 },
    { x: 0.67, y: 0.4 },
    { x: 0.38, y: 0.35 },
    { x: 0.2, y: 0.25 },
    { x: 0.48, y: 0.16 },
  ],
  // Norse — hard diagonal cuts through the ice.
  [
    { x: 0.2, y: 0.88 },
    { x: 0.48, y: 0.84 },
    { x: 0.78, y: 0.75 },
    { x: 0.54, y: 0.67 },
    { x: 0.24, y: 0.61 },
    { x: 0.43, y: 0.51 },
    { x: 0.75, y: 0.45 },
    { x: 0.58, y: 0.34 },
    { x: 0.28, y: 0.27 },
    { x: 0.54, y: 0.16 },
  ],
  // Greece — a balanced temple stair.
  [
    { x: 0.22, y: 0.9 },
    { x: 0.45, y: 0.83 },
    { x: 0.72, y: 0.83 },
    { x: 0.72, y: 0.69 },
    { x: 0.45, y: 0.64 },
    { x: 0.22, y: 0.57 },
    { x: 0.22, y: 0.43 },
    { x: 0.48, y: 0.37 },
    { x: 0.75, y: 0.29 },
    { x: 0.51, y: 0.17 },
  ],
  // China — a long river bend.
  [
    { x: 0.78, y: 0.9 },
    { x: 0.57, y: 0.83 },
    { x: 0.33, y: 0.79 },
    { x: 0.18, y: 0.68 },
    { x: 0.35, y: 0.58 },
    { x: 0.62, y: 0.55 },
    { x: 0.8, y: 0.45 },
    { x: 0.65, y: 0.34 },
    { x: 0.4, y: 0.29 },
    { x: 0.2, y: 0.18 },
  ],
  // Persia — two gates and a central approach.
  [
    { x: 0.18, y: 0.88 },
    { x: 0.43, y: 0.84 },
    { x: 0.78, y: 0.87 },
    { x: 0.66, y: 0.73 },
    { x: 0.35, y: 0.69 },
    { x: 0.19, y: 0.57 },
    { x: 0.45, y: 0.49 },
    { x: 0.78, y: 0.43 },
    { x: 0.63, y: 0.29 },
    { x: 0.37, y: 0.17 },
  ],
  // Japan — quick foxfire zigzags.
  [
    { x: 0.78, y: 0.89 },
    { x: 0.48, y: 0.82 },
    { x: 0.2, y: 0.75 },
    { x: 0.42, y: 0.66 },
    { x: 0.75, y: 0.61 },
    { x: 0.56, y: 0.51 },
    { x: 0.24, y: 0.44 },
    { x: 0.43, y: 0.34 },
    { x: 0.75, y: 0.27 },
    { x: 0.5, y: 0.16 },
  ],
  // Mayan — a spiral toward the volcano.
  [
    { x: 0.18, y: 0.86 },
    { x: 0.45, y: 0.9 },
    { x: 0.78, y: 0.82 },
    { x: 0.81, y: 0.65 },
    { x: 0.61, y: 0.52 },
    { x: 0.32, y: 0.55 },
    { x: 0.18, y: 0.42 },
    { x: 0.33, y: 0.27 },
    { x: 0.61, y: 0.25 },
    { x: 0.54, y: 0.12 },
  ],
  // Tribal — a drumbeat crossing the center line.
  [
    { x: 0.5, y: 0.91 },
    { x: 0.22, y: 0.83 },
    { x: 0.48, y: 0.76 },
    { x: 0.78, y: 0.69 },
    { x: 0.51, y: 0.61 },
    { x: 0.2, y: 0.53 },
    { x: 0.48, y: 0.45 },
    { x: 0.78, y: 0.37 },
    { x: 0.5, y: 0.27 },
    { x: 0.24, y: 0.17 },
  ],
  // Inca — a narrow ascent to the summit.
  [
    { x: 0.22, y: 0.9 },
    { x: 0.48, y: 0.85 },
    { x: 0.75, y: 0.78 },
    { x: 0.58, y: 0.68 },
    { x: 0.3, y: 0.62 },
    { x: 0.18, y: 0.5 },
    { x: 0.42, y: 0.43 },
    { x: 0.73, y: 0.36 },
    { x: 0.61, y: 0.24 },
    { x: 0.36, y: 0.14 },
  ],
] as const;

function fixedZoneLayout(
  path: readonly MapLayoutPoint[],
  nodesPerZone: number,
): ZoneLayout {
  const points = path.slice(0, nodesPerZone).map((point) => ({
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
      Array.from({ length: totalZones }, (_, realm) =>
        fixedZoneLayout(
          CAMPAIGN_PATHS[realm] ?? CAMPAIGN_PATHS[0],
          nodesPerZone,
        ),
      ),
    [nodesPerZone, totalZones],
  );
}
