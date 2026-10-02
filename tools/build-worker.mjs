// Bundles the Worker (read model and keeper) for Cloudflare's runtime into
// dist/worker: one ES module beside the core's WASM. Wrangler uploads the
// directory as built (no_bundle), so what the tests run is what deploys.
import { builtinModules } from "node:module";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const out = new URL("dist/worker/", root);
const builtins = new Set(builtinModules);

await build({
  entryPoints: [fileURLToPath(new URL("services/src/worker/worker.ts", root))],
  outfile: fileURLToPath(new URL("worker.js", out)),
  bundle: true, format: "esm", platform: "browser", target: "es2022",
  conditions: ["workerd", "worker", "browser"], logLevel: "warning",
  // Dependencies still call require() for the Node modules the runtime provides.
  banner: { js: [
    'import * as __buffer from "node:buffer"; import * as __crypto from "node:crypto";',
    'import * as __util from "node:util"; import * as __events from "node:events";',
    'const __provided = { buffer: __buffer, crypto: __crypto, util: __util, events: __events };',
    'const require = (name) => { const found = __provided[name.replace(/^node:/, "")];',
    '  if (!found) throw new Error(`module ${name} is not provided`); return found.default ?? found; };',
  ].join("\n") },
  plugins: [{ name: "worker-runtime", setup(build) {
    build.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, ({ path }) => {
      const name = path.replace(/^node:/, "");
      return builtins.has(name) ? { path: `node:${name}`, external: true } : undefined;
    });
    // The Worker receives the core as a compiled module, not as file bytes.
    build.onResolve({ filter: /zkubeCoreWasm\.js$/ }, ({ resolveDir }) =>
      ({ path: fileURLToPath(new URL("zkubeCoreWasm.worker.ts", `file://${resolveDir}/`)) }));
    build.onResolve({ filter: /\.wasm$/ }, () => ({ path: "./zkube_core_bg.wasm", external: true }));
  } }],
});
mkdirSync(out, { recursive: true });
cpSync(new URL("services/zkube-core/zkube_core_bg.wasm", root), new URL("zkube_core_bg.wasm", out));
