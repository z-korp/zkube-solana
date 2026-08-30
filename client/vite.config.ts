import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";
import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const SERVICE_WORKER_VERSION_PLACEHOLDER = "__ZKUBE_BUILD_VERSION__";
const HTTPS_CERT_PATH_ENV = "ZKUBE_HTTPS_CERT_PATH";
const HTTPS_KEY_PATH_ENV = "ZKUBE_HTTPS_KEY_PATH";
const DEV_PLAYTEST_ACTION_SENTINEL = "zkube_playtest_action_v1";
const LOCAL_BACKEND_SENTINEL = "zkube_local_backend_v1";
const PLAYTEST_BUILD_SENTINEL = "zkube_owner_playtest_v1";

function localHttpsOptions():
  | Readonly<{ cert: Buffer; key: Buffer }>
  | undefined {
  const certPath = process.env[HTTPS_CERT_PATH_ENV];
  const keyPath = process.env[HTTPS_KEY_PATH_ENV];
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) {
    throw new Error(
      `${HTTPS_CERT_PATH_ENV} and ${HTTPS_KEY_PATH_ENV} must be set together`,
    );
  }
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

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

/** Fails closed if local/playtest code enters an ordinary shipping build. */
function excludeNonShippingCode(): Plugin {
  const ownerPlaytest = process.env.VITE_ZKUBE_PLAYTEST === "1";
  return {
    name: "zkube-shipping-build-has-no-playtest-flag",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        const contents =
          output.type === "chunk"
            ? output.code
            : typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source).toString("utf8");
        if (contents.includes(DEV_PLAYTEST_ACTION_SENTINEL)) {
          throw new Error(
            `Dev-only code entered release asset ${output.fileName}`,
          );
        }
        if (
          !ownerPlaytest &&
          (contents.includes(LOCAL_BACKEND_SENTINEL) ||
            contents.includes(PLAYTEST_BUILD_SENTINEL))
        ) {
          throw new Error(
            `Playtest code entered shipping asset ${output.fileName}`,
          );
        }
      }
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
    nodePolyfills({ include: ["buffer", "process", "stream", "util"] }),
    versionServiceWorker(),
    excludeNonShippingCode(),
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
        manualChunks:
          process.env.VITE_ZKUBE_PLAYTEST === "1"
            ? { "vendor-ui": ["motion"] }
            : {
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
    https: localHttpsOptions(),
  },
});
