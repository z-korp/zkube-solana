// The one canonical way a release program is built, and the record a deploy
// plan reads. A hash is evidence only for the exact compiler, tools and
// options that produced it, so they are pinned here and travel with the ELF.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256 } from "./chainRelease.js";

export const RELEASE_BUILD = Object.freeze({
  cargoBuildSbf: "3.1.10",
  platformTools: "v1.52",
  rustc: "1.89.0",
  // The tool's defaults stated outright: the v0 architecture, and the working
  // directory remapped out of the binary so the hash does not depend on where
  // the checkout lives. Dependencies resolve only as the lock file says.
  arguments: Object.freeze(["build-sbf", "--manifest-path", "programs/solana/Cargo.toml", "--arch", "v0",
    "--sbf-out-dir", "build/chain/release", "--", "--locked"]),
  target: "sbpf-solana-solana",
  // Every flag the compiler is given, as cargo's own fingerprint reports it.
  rustflags: Object.freeze(["-Zremap-cwd-prefix="]),
  // The whole environment of the build. Nothing else is inherited, so no
  // RUSTFLAGS, wrapper, profile or target override can reach the compiler.
  environment: Object.freeze({ NO_DNA: "1", CARGO_NET_OFFLINE: "true", CARGO_BUILD_JOBS: "6" }),
  inherited: Object.freeze(["PATH", "HOME"]),
  targetDirectory: "build/chain/release-target",
  artifact: "build/chain/release/solana.so",
});
const RECORD = "build/chain/release/solana.release.json";

export type RunCargo = (args: readonly string[], env: Record<string, string>, cwd: string) => string;
const cargo: RunCargo = (args, env, cwd) => execFileSync("cargo", [...args],
  { encoding: "utf8", env, cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/**
 * The loader a cluster runs decides what a release may import, not a copy of
 * its rules: programs/solana/examples/release-gate.rs deploys the ELF with the
 * pinned solana-bpf-loader-program and agave syscall registry under a feature
 * set with every gate off, the most conservative cluster. Devnet refused to
 * deploy a program importing sol_remaining_compute_units, whose gate was off.
 */
export const RELEASE_GATE = Object.freeze(["run", "-q", "--offline", "--locked", "-p", "solana", "--example", "release-gate", "--"]);

function cargoEnvironment(inherited: Record<string, string | undefined>) {
  const env: Record<string, string> = { ...RELEASE_BUILD.environment };
  for (const name of RELEASE_BUILD.inherited) {
    const value = inherited[name];
    if (!value) throw new Error(`Release build needs ${name}`);
    env[name] = value;
  }
  return env;
}

/** Refuses an ELF the pinned loader does not deploy with every feature gate off. */
function requireLoaderDeploys(path: string, root: string, run: RunCargo, inherited: Record<string, string | undefined>) {
  try { run([...RELEASE_GATE, path], cargoEnvironment(inherited), root); }
  catch (error) {
    const said = (error as { stderr?: unknown }).stderr;
    throw new Error(`Release is refused by the pinned loader with every feature gate off: ${
      typeof said === "string" && said.trim() ? said.trim() : (error as Error).message}`);
  }
}

/**
 * Builds the release ELF from the repository root, from a clean target, with
 * the pinned tools and only the recorded compiler inputs, offline, and records
 * what built it. A build whose compiler saw any other flags leaves no record.
 */
export function buildRelease(given: string, run: RunCargo = cargo,
  inherited: Record<string, string | undefined> = process.env) {
  // A checkout reached through a symlink is built where it really lives,
  // which is where cargo looks for configuration: every path below is the
  // real one, and the directories above both paths are checked.
  const root = realpathSync(given);
  const env: Record<string, string> = { ...cargoEnvironment(inherited), CARGO_TARGET_DIR: resolve(root, RELEASE_BUILD.targetDirectory) };
  // Cargo merges every configuration file it finds above the repository and
  // beside the user's toolchain, and any key in one (a flag, a profile by
  // table or by dotted key, a target, an environment variable) can change the
  // ELF without a trace here. None is read to decide which are harmless: the
  // release build runs only where no outside configuration exists.
  const outside = [resolve(env.HOME!, ".cargo")];
  for (const start of new Set([resolve(given), root])) {
    for (let directory = dirname(start); ; directory = dirname(directory)) {
      outside.push(resolve(directory, ".cargo"));
      if (directory === dirname(directory)) break;
    }
  }
  for (const directory of outside) {
    for (const file of ["config.toml", "config"]) {
      if (existsSync(resolve(directory, file))) {
        throw new Error(`Release build refuses a cargo configuration outside the repository: ${resolve(directory, file)}`);
      }
    }
  }
  const versions = run(["build-sbf", "--version"], env, root);
  for (const [name, expected] of [["solana-cargo-build-sbf", RELEASE_BUILD.cargoBuildSbf],
    ["platform-tools", RELEASE_BUILD.platformTools], ["rustc", RELEASE_BUILD.rustc]] as const) {
    const found = new RegExp(`^${name} (\\S+)$`, "m").exec(versions)?.[1];
    if (found !== expected) throw new Error(`Release build needs ${name} ${expected}; found ${found ?? "none"}`);
  }
  // Nothing an earlier build left behind may reach the release.
  for (const stale of [RELEASE_BUILD.targetDirectory, "build/chain/release"]) rmSync(resolve(root, stale), { recursive: true, force: true });
  mkdirSync(resolve(root, "build/chain/release"), { recursive: true });
  run(RELEASE_BUILD.arguments, env, root);
  // The compiler's own account of its flags must be exactly the recorded set.
  const fingerprints = resolve(root, RELEASE_BUILD.targetDirectory, RELEASE_BUILD.target, "release/.fingerprint");
  const program = existsSync(fingerprints) ? readdirSync(fingerprints).filter((name) => /^solana-[0-9a-f]{16}$/.test(name)) : [];
  const flags = program.length === 1
    ? (JSON.parse(readFileSync(resolve(fingerprints, program[0]!, "lib-solana.json"), "utf8")) as { rustflags?: unknown }).rustflags
    : undefined;
  if (JSON.stringify(flags) !== JSON.stringify(RELEASE_BUILD.rustflags)) {
    rmSync(resolve(root, "build/chain/release"), { recursive: true, force: true });
    throw new Error("Release build's compiler flags differ from the pinned build configuration");
  }
  // The gate builds in the workspace target, never the release's.
  try { requireLoaderDeploys(resolve(root, RELEASE_BUILD.artifact), root, run, inherited); }
  catch (error) { rmSync(resolve(root, "build/chain/release"), { recursive: true, force: true }); throw error; }
  const bytes = readFileSync(resolve(root, RELEASE_BUILD.artifact));
  const record = { recipe: RELEASE_BUILD, sha256: sha256(bytes), bytes: bytes.length };
  writeFileSync(resolve(root, RECORD), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** The release ELF a plan may quote: built by the pinned recipe, unchanged since, and the hash the owner reviewed. */
export function releaseArtifact(root: string, reviewedSha256: string, run: RunCargo = cargo,
  inherited: Record<string, string | undefined> = process.env) {
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
  requireLoaderDeploys(path, root, run, inherited);
  return { artifactPath: path, artifactSha256: reviewedSha256, artifactBytes: bytes.length };
}
