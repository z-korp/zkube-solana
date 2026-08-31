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
const SOLANA_BACKEND_SENTINEL = "zkube_solana_backend_v1";
const MONEY_SURFACE_SENTINEL = "zkube_money_surface_v1";
type BuildTarget = "solana" | "store" | "playtest";

const BUILD_TARGET_EXCLUSIONS: Readonly<
  Record<BuildTarget, readonly string[]>
> = {
  solana: [LOCAL_BACKEND_SENTINEL, PLAYTEST_BUILD_SENTINEL],
  store: [
    SOLANA_BACKEND_SENTINEL,
    PLAYTEST_BUILD_SENTINEL,
    MONEY_SURFACE_SENTINEL,
  ],
  playtest: [SOLANA_BACKEND_SENTINEL],
};

function buildTarget(): BuildTarget {
  const target = process.env.VITE_ZKUBE_BUILD ?? "solana";
  if (target === "solana" || target === "store" || target === "playtest") {
    return target;
  }
  throw new Error(`Unknown VITE_ZKUBE_BUILD target: ${target}`);
}

const BUILD_TARGET_BACKENDS: Readonly<Record<BuildTarget, string>> = {
  solana: "./src/backend/solana/selectedBackend.ts",
  store: "./src/backend/local/storeBackend.ts",
  playtest: "./src/backend/local/playtestBackend.ts",
};
const BUILD_TARGET_PAGE_SETS: Readonly<Record<BuildTarget, string>> = {
  solana: "./src/ui/pageSets/solana.tsx",
  store: "./src/ui/pageSets/store.tsx",
  playtest: "./src/ui/pageSets/playtest.tsx",
};
const BUILD_TARGET_DAILY_RESULTS: Readonly<Record<BuildTarget, string>> = {
  solana: "./src/ui/components/GameOverDialog.tsx",
  store: "./src/ui/components/local/LocalDailyResultDialog.tsx",
  playtest: "./src/ui/components/local/LocalDailyResultDialog.tsx",
};
const BUILD_TARGET_ARCADE_ICONS: Readonly<Record<BuildTarget, string>> = {
  solana: "./src/ui/navigation/money/ArcadeDockIcon.tsx",
  store: "./src/ui/navigation/local/ArcadeDockIcon.tsx",
  playtest: "./src/ui/navigation/local/ArcadeDockIcon.tsx",
};

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

/** Fails closed if one product target contains another target's surface. */
function excludeNonShippingCode(): Plugin {
  const target = buildTarget();
  return {
    name: "zkube-build-target-exclusions",
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
        for (const sentinel of BUILD_TARGET_EXCLUSIONS[target]) {
          if (contents.includes(sentinel)) {
            throw new Error(
              `${target} build contains excluded surface in ${output.fileName}`,
            );
          }
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
          buildTarget() !== "solana"
            ? { "vendor-ui": ["motion"] }
            : {
                "vendor-solana": ["@solana/web3.js", "@anchor-lang/core"],
                "vendor-ui": ["motion"],
              },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "@/backend/selected",
        replacement: path.resolve(
          __dirname,
          BUILD_TARGET_BACKENDS[buildTarget()],
        ),
      },
      {
        find: "@/ui/pageSet",
        replacement: path.resolve(
          __dirname,
          BUILD_TARGET_PAGE_SETS[buildTarget()],
        ),
      },
      {
        find: "@/ui/components/DailyResultDialog",
        replacement: path.resolve(
          __dirname,
          BUILD_TARGET_DAILY_RESULTS[buildTarget()],
        ),
      },
      {
        find: "@/ui/navigation/ArcadeDockIcon",
        replacement: path.resolve(
          __dirname,
          BUILD_TARGET_ARCADE_ICONS[buildTarget()],
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  server: {
    host: true,
    port: 5175,
    https: localHttpsOptions(),
  },
});
