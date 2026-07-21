import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WASM_PACK_VERSION = "0.13.1";
const generatedFiles = [
  "package.json",
  "zkube_core.d.ts",
  "zkube_core.js",
  "zkube_core_bg.wasm",
  "zkube_core_bg.wasm.d.ts",
];
const check = process.argv.includes("--check");
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(clientRoot, "..");
const crate = resolve(workspaceRoot, "crates/zkube-core-wasm");
const destination = resolve(clientRoot, "src/core/generated");
const temporary = mkdtempSync(resolve(tmpdir(), "zkube-core-wasm-"));

try {
  const version = spawnSync("wasm-pack", ["--version"], {
    encoding: "utf8",
  });
  if (version.status !== 0) {
    throw new Error("wasm-pack is required to generate zkube-core bindings");
  }
  if (version.stdout.trim() !== `wasm-pack ${WASM_PACK_VERSION}`) {
    throw new Error(
      `expected wasm-pack ${WASM_PACK_VERSION}, received ${version.stdout.trim()}`,
    );
  }

  const built = spawnSync(
    "wasm-pack",
    [
      "build",
      "--target",
      "web",
      "--out-dir",
      temporary,
      "--out-name",
      "zkube_core",
      "--release",
      crate,
      "--",
      "--locked",
      "--features",
      "wasm-bindgen",
    ],
    { cwd: workspaceRoot, stdio: "inherit" },
  );
  if (built.status !== 0) {
    throw new Error(`wasm-pack exited with status ${built.status ?? "unknown"}`);
  }

  const actualFiles = readdirSync(temporary)
    .filter((name) => name !== ".gitignore")
    .sort();
  if (actualFiles.join("\n") !== [...generatedFiles].sort().join("\n")) {
    throw new Error(
      `generated file set changed: ${actualFiles.join(", ")}`,
    );
  }

  const stale = generatedFiles.filter((name) => {
    try {
      return !readFileSync(resolve(temporary, name)).equals(
        readFileSync(resolve(destination, name)),
      );
    } catch {
      return true;
    }
  });
  if (check && stale.length > 0) {
    throw new Error(
      `zkube-core WASM bindings are stale: ${stale.join(", ")}. Run pnpm core:wasm:sync.`,
    );
  }
  if (!check) {
    for (const name of generatedFiles) {
      copyFileSync(resolve(temporary, name), resolve(destination, name));
    }
    process.stdout.write("Updated zkube-core WASM bindings.\n");
  } else {
    process.stdout.write("zkube-core WASM bindings are current.\n");
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
