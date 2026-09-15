// @vitest-environment node
import { readFileSync } from "node:fs";

describe("LocalBackendLive production boundary", () => {
  it("each_build_target_excludes_the_other_targets", () => {
    const config = readFileSync(
      new URL("../../../vite.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain("zkube_owner_playtest_v1");
    expect(config).toContain("zkube_solana_backend_v1");
    expect(config).toContain("zkube_money_surface_v1");
    expect(config).toContain("VITE_ZKUBE_BUILD");
    expect(config).toContain("Dev-only code entered release asset");
    expect(config).toContain(
      "solana: [PLAYTEST_BUILD_SENTINEL]",
    );
    expect(config).toContain("store: [");
    expect(config).toContain("playtest: [SOLANA_BACKEND_SENTINEL]");
  });
});
