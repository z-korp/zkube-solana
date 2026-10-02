// The one canonical way a release program is built, and the record a deploy
// plan reads. A hash is evidence only for the exact compiler, tools and
// options that produced it, so they are pinned here and travel with the ELF.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "./chainRelease.js";

export const RELEASE_BUILD = Object.freeze({
  cargoBuildSbf: "3.1.10",
  platformTools: "v1.52",
  rustc: "1.89.0",
  // The tool's defaults stated outright: the v0 architecture, and the working
  // directory remapped out of the binary so the hash does not depend on where
  // the checkout lives.
  arguments: Object.freeze(["build-sbf", "--manifest-path", "programs/solana/Cargo.toml", "--arch", "v0",
    "--sbf-out-dir", "build/chain/release"]),
  targetDirectory: "build/chain/release-target",
  artifact: "build/chain/release/solana.so",
});
const RECORD = "build/chain/release/solana.release.json";

export type RunCargo = (args: readonly string[], env: Record<string, string>) => string;
const cargo: RunCargo = (args, env) => execFileSync("cargo", [...args],
  { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/** Builds the release ELF from a clean target with the pinned tools, offline, and records what built it. */
export function buildRelease(root: string, run: RunCargo = cargo) {
  const versions = run(["build-sbf", "--version"], {});
  for (const [name, expected] of [["solana-cargo-build-sbf", RELEASE_BUILD.cargoBuildSbf],
    ["platform-tools", RELEASE_BUILD.platformTools], ["rustc", RELEASE_BUILD.rustc]] as const) {
    const found = new RegExp(`^${name} (\\S+)$`, "m").exec(versions)?.[1];
    if (found !== expected) throw new Error(`Release build needs ${name} ${expected}; found ${found ?? "none"}`);
  }
  // Nothing an earlier build left behind may reach the release.
  for (const stale of [RELEASE_BUILD.targetDirectory, "build/chain/release"]) rmSync(resolve(root, stale), { recursive: true, force: true });
  mkdirSync(resolve(root, "build/chain/release"), { recursive: true });
  run(RELEASE_BUILD.arguments, { NO_DNA: "1", CARGO_NET_OFFLINE: "true",
    CARGO_TARGET_DIR: resolve(root, RELEASE_BUILD.targetDirectory) });
  const bytes = readFileSync(resolve(root, RELEASE_BUILD.artifact));
  const record = { recipe: RELEASE_BUILD, sha256: sha256(bytes), bytes: bytes.length };
  writeFileSync(resolve(root, RECORD), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** The release ELF a plan may quote: built by the pinned recipe, unchanged since, and the hash the owner reviewed. */
export function releaseArtifact(root: string, reviewedSha256: string) {
  const path = resolve(root, RELEASE_BUILD.artifact);
  if (!existsSync(path) || !existsSync(resolve(root, RECORD))) {
    throw new Error("No release build found; run `pnpm chain build-release` first");
  }
  let record: { recipe?: unknown; sha256?: unknown; bytes?: unknown };
  try { record = JSON.parse(readFileSync(resolve(root, RECORD), "utf8")); } catch { record = {}; }
  if (JSON.stringify(record.recipe) !== JSON.stringify(RELEASE_BUILD)) {
    throw new Error("Release build was not made with the pinned build configuration");
  }
  const bytes = readFileSync(path);
  if (record.sha256 !== sha256(bytes) || record.bytes !== bytes.length) {
    throw new Error("Release artifact changed after it was built");
  }
  if (reviewedSha256 !== record.sha256) throw new Error("Frozen artifact hash differs from release input");
  return { artifactPath: path, artifactSha256: reviewedSha256, artifactBytes: bytes.length };
}
