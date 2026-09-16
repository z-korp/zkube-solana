import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node",
  include: ["services/tests/**/*.test.ts", "tools/chain/*.test.ts"] } });
