// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseZkubeBuildTarget } from "./buildTarget";

describe("build target", () => {
  it("defaults to Solana and accepts only the three product targets", () => {
    expect(parseZkubeBuildTarget(undefined)).toBe("solana");
    expect(parseZkubeBuildTarget("solana")).toBe("solana");
    expect(parseZkubeBuildTarget("store")).toBe("store");
    expect(parseZkubeBuildTarget("playtest")).toBe("playtest");
    expect(() => parseZkubeBuildTarget("preview")).toThrow(
      "Unknown VITE_ZKUBE_BUILD target",
    );
  });
});
