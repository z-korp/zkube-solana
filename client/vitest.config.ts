/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

// Vitest must load React's development test entry points even when the parent
// shell was used for a production build before invoking the local test gate.
process.env.NODE_ENV = "test";

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  test: {
    globals: true,
    environment: "jsdom",
    // Unity fixture producers read files and execute offline Node adapters.
    environmentMatchGlobs: [["tools/unity/**", "node"]],
    setupFiles: "./src/test/setup.ts",
    include: [
      "src/**/*.{test,spec}.{js,ts,jsx,tsx}",
      "tests/**/*.{test,spec}.{js,ts,jsx,tsx}",
      "tools/**/*.{test,spec}.{js,ts,jsx,tsx}",
    ],
  },
});
