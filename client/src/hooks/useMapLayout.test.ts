import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMapLayout } from "./useMapLayout";

const params = (totalZones = 10) => ({
  totalZones,
  nodesPerZone: 10,
});

const EPSILON = 1e-9;

describe("useMapLayout authored path", () => {
  it("keeps every authored realm path inside the playable canvas", () => {
    const { result } = renderHook(() => useMapLayout(params()));
    expect(result.current).toHaveLength(10);

    for (const { points, edges } of result.current) {
      expect(points).toHaveLength(10);
      expect(points[0].y).toBeGreaterThan(points[9].y);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0.15 - EPSILON);
        expect(point.x).toBeLessThanOrEqual(0.85 + EPSILON);
        expect(point.y).toBeGreaterThanOrEqual(0.1 - EPSILON);
        expect(point.y).toBeLessThanOrEqual(0.92 + EPSILON);
      }
      expect(edges).toHaveLength(9);
      expect(edges[0]).toEqual({ from: 0, to: 1 });
      expect(edges[8]).toEqual({ from: 8, to: 9 });
    }
  });

  it("uses a stable, distinct authored path for every realm", () => {
    const first = renderHook(() => useMapLayout(params())).result.current;
    const second = renderHook(() => useMapLayout(params())).result.current;

    expect(first).toEqual(second);
    expect(
      new Set(first.map((layout) => JSON.stringify(layout.points))).size,
    ).toBe(10);
  });
});
