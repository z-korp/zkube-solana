import path from "path";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { paymasterDevPlugin } from "./src/server/paymasterVitePlugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    paymasterDevPlugin(),
    // Note: mkcert (local HTTPS) retiré — Vercel gère HTTPS automatiquement
    nodePolyfills({ include: ["buffer", "process", "stream", "util"] }),
  ],
  build: {
    target: "ES2022",
    rollupOptions: {
      input: {
        main: "index.html",
      },
      output: {
        manualChunks: {
          "vendor-solana": ["@solana/web3.js", "@anchor-lang/core"],
          "vendor-ui": ["motion"],
        },
      },
    },
  },
  resolve: {
    alias: [
      // Classic-UI compat: pages ported verbatim from the original client
      // keep their "@/dojo/*" imports; they resolve to the Solana adapters.
      {
        find: /^@\/dojo\//,
        replacement: `${path.resolve(__dirname, "./src/compat/dojo")}/`,
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  server: {
    host: true,
    port: 5175,
  },
});
