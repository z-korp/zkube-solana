// @vitest-environment node
import { readFileSync } from "node:fs";

describe("LocalBackendLive production boundary", () => {
  it("local_backend_is_dev_only", () => {
    const config = readFileSync(
      new URL("../../../vite.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain("zkube_local_backend_v1");
    expect(config).toContain("Dev-only code entered release asset");
  });
});
