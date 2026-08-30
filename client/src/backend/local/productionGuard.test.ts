// @vitest-environment node
import { readFileSync } from "node:fs";

describe("LocalBackendLive production boundary", () => {
  it("shipping_build_has_no_playtest_flag", () => {
    const config = readFileSync(
      new URL("../../../vite.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain("zkube_local_backend_v1");
    expect(config).toContain("zkube_owner_playtest_v1");
    expect(config).toContain("VITE_ZKUBE_PLAYTEST");
    expect(config).toContain("Dev-only code entered release asset");
    expect(config).toContain("Playtest code entered shipping asset");
  });
});
