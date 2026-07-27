import { createHash } from "node:crypto";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";
import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const SERVICE_WORKER_VERSION_PLACEHOLDER = "__ZKUBE_BUILD_VERSION__";

/**
 * Binds CacheStorage to the exact deterministic build output. The worker is a
 * Rollup entry rather than a public-file copy so the version changes whenever
 * its policy or any emitted app shell byte changes, while identical inputs
 * produce the same version.
 */
function versionServiceWorker(): Plugin {
  return {
    name: "zkube-version-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const worker = bundle["sw.js"];
      if (!worker || worker.type !== "chunk") {
        throw new Error("The zKube service-worker build entry is missing");
      }
      if (!worker.code.includes(SERVICE_WORKER_VERSION_PLACEHOLDER)) {
        throw new Error(
          "The zKube service-worker version placeholder is missing",
        );
      }

      const hash = createHash("sha256");
      for (const fileName of Object.keys(bundle).sort()) {
        const output = bundle[fileName];
        hash.update(fileName);
        hash.update("\0");
        if (output.type === "chunk") {
          hash.update(output.code);
        } else {
          hash.update(
            typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source),
          );
        }
        hash.update("\0");
      }
      const version = hash.digest("hex").slice(0, 16);
      worker.code = worker.code.replaceAll(
        SERVICE_WORKER_VERSION_PLACEHOLDER,
        version,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    // Note: mkcert (local HTTPS) retiré — Vercel gère HTTPS automatiquement
    nodePolyfills({ include: ["buffer", "process", "stream", "util"] }),
    versionServiceWorker(),
  ],
  build: {
    target: "ES2022",
    rollupOptions: {
      input: {
        main: "index.html",
        serviceWorker: path.resolve(
          __dirname,
          "./src/platform/serviceWorker.ts",
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "serviceWorker" ? "sw.js" : "assets/[name]-[hash].js",
        manualChunks: {
          "vendor-solana": ["@solana/web3.js", "@anchor-lang/core"],
          "vendor-ui": ["motion"],
        },
      },
    },
  },
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  server: {
    host: true,
    port: 5175,
  },
});
