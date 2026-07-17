import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMapLayout } from "./useMapLayout";

const params = (seed: number, totalZones = 1) => ({
  seed,
  totalZones,
  nodesPerZone: 10,
});

const EPSILON = 1e-9;

describe("useMapLayout organic walk", () => {
  it("keeps the walk invariants across many seeds", () => {
    for (const seed of [1, 2, 5, 9, 42].map((z) => z * 48_271 + 12_347)) {
      const { result } = renderHook(() => useMapLayout(params(seed)));
      const { points, edges } = result.current[0];

      expect(points).toHaveLength(10);
      // Level 1 and the boss anchor the ladder at center, bottom to top.
      expect(points[0].x).toBe(0.5);
      expect(points[9].x).toBe(0.5);
      expect(points[0].y).toBeGreaterThan(points[9].y);

      for (let i = 1; i <= 8; i++) {
        expect(points[i].x).toBeGreaterThanOrEqual(0.15 - EPSILON);
        expect(points[i].x).toBeLessThanOrEqual(0.85 + EPSILON);
        // Consecutive nodes always shift horizontally — the zigzag rhythm.
        expect(Math.abs(points[i].x - points[i - 1].x)).toBeGreaterThanOrEqual(
          0.15 - EPSILON,
        );
      }
      // Level 2 stays clear of the bottom-right guardian portrait.
      expect(points[1].x).toBeLessThanOrEqual(0.65 + EPSILON);

      expect(edges).toHaveLength(9);
      expect(edges[0]).toEqual({ from: 0, to: 1, kind: "main" });
    }
  });

  it("is deterministic per seed and varies across zones", () => {
    const first = renderHook(() => useMapLayout(params(123, 2))).result
      .current;
    const second = renderHook(() => useMapLayout(params(123, 2))).result
      .current;

    expect(first).toEqual(second);
    expect(first[0].points).not.toEqual(first[1].points);
  });
});
