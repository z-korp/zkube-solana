import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMapLayout } from "./useMapLayout";

const params = (totalZones = 1) => ({
  totalZones,
  nodesPerZone: 10,
});

const EPSILON = 1e-9;

describe("useMapLayout authored path", () => {
  it("keeps the fixed ladder clear and ordered", () => {
    const { result } = renderHook(() => useMapLayout(params()));
    const { points, edges } = result.current[0];

    expect(points).toHaveLength(10);
    expect(points[0].x).toBe(0.5);
    expect(points[9].x).toBe(0.5);
    expect(points[0].y).toBeGreaterThan(points[9].y);

    for (let i = 1; i <= 8; i++) {
      expect(points[i].x).toBeGreaterThanOrEqual(0.15 - EPSILON);
      expect(points[i].x).toBeLessThanOrEqual(0.85 + EPSILON);
      expect(Math.abs(points[i].x - points[i - 1].x)).toBeGreaterThanOrEqual(
        0.15 - EPSILON,
      );
    }
    expect(points[1].x).toBeLessThanOrEqual(0.65 + EPSILON);
    expect(edges).toHaveLength(9);
    expect(edges[0]).toEqual({ from: 0, to: 1 });
  });

  it("uses the same authored furniture for every realm", () => {
    const first = renderHook(() => useMapLayout(params(2))).result.current;
    const second = renderHook(() => useMapLayout(params(2))).result.current;

    expect(first).toEqual(second);
    expect(first[0].points).toEqual(first[1].points);
  });
});
