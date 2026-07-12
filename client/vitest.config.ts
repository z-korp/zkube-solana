/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/dojo\//,
        replacement: `${path.resolve(__dirname, "./src/compat/dojo")}/`,
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
  },
});
