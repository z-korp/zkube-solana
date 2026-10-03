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

/**
 * The syscalls a release may import: those the loader registers on every
 * cluster, with no feature gate. A program importing any other is refused at
 * deployment wherever its gate is off, as sol_remaining_compute_units was on
 * Devnet. Verified against agave-syscalls 3.0.14 (create_program_runtime_
 * environment_v1, the pinned toolchain's runtime): each name below is
 * registered with register_function, not register_feature_gated_function, so
 * Devnet and mainnet both have it whatever their feature status. A gated
 * syscall joins this list only after `solana feature status` shows its gate
 * active on Devnet and mainnet alike.
 */
export const UNGATED_SYSCALLS: readonly string[] = Object.freeze([
  "abort", "sol_panic_", "sol_log_", "sol_log_64_", "sol_log_pubkey", "sol_log_compute_units_", "sol_log_data",
  "sol_create_program_address", "sol_try_find_program_address", "sol_sha256", "sol_keccak256", "sol_secp256k1_recover",
  "sol_get_clock_sysvar", "sol_get_epoch_schedule_sysvar", "sol_get_rent_sysvar", "sol_get_epoch_rewards_sysvar",
  "sol_memcpy_", "sol_memmove_", "sol_memset_", "sol_memcmp_",
  "sol_get_processed_sibling_instruction", "sol_get_stack_height", "sol_set_return_data", "sol_get_return_data",
  "sol_invoke_signed_c", "sol_invoke_signed_rust",
]);

/** The symbols an SBF ELF imports: its undefined dynamic symbols, which the loader resolves as syscalls. */
export function importedSyscalls(elf: Buffer): string[] {
  if (elf.length < 64 || !elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || elf[4] !== 2 || elf[5] !== 1) {
    throw new Error("Release artifact is not a little-endian 64-bit ELF");
  }
  const sectionsAt = Number(elf.readBigUInt64LE(0x28));
  const sectionSize = elf.readUInt16LE(0x3a), sectionCount = elf.readUInt16LE(0x3c);
  const section = (index: number) => {
    const at = sectionsAt + index * sectionSize;
    return { type: elf.readUInt32LE(at + 4), offset: Number(elf.readBigUInt64LE(at + 0x18)),
      size: Number(elf.readBigUInt64LE(at + 0x20)), link: elf.readUInt32LE(at + 0x28), entry: Number(elf.readBigUInt64LE(at + 0x38)) };
  };
  const names = new Set<string>();
  for (let index = 0; index < sectionCount; index++) {
    const table = section(index);
    if (table.type !== 11 || table.entry < 24) continue; // SHT_DYNSYM
    const strings = section(table.link);
    for (let at = table.offset; at + 24 <= table.offset + table.size; at += table.entry) {
      const name = elf.readUInt32LE(at), defined = elf.readUInt16LE(at + 6);
      if (name === 0 || defined !== 0) continue;
      const start = strings.offset + name;
      names.add(elf.toString("latin1", start, elf.indexOf(0, start)));
    }
  }
  return [...names].sort();
}

/** Refuses an ELF that imports a syscall a cluster may not have. */
export function requireUngatedSyscalls(elf: Buffer): void {
  const outside = importedSyscalls(elf).filter((name) => !UNGATED_SYSCALLS.includes(name));
  if (outside.length) throw new Error(`Release imports syscalls that are not active on every cluster: ${outside.join(", ")}`);
}

export type RunCargo = (args: readonly string[], env: Record<string, string>, cwd: string) => string;
const cargo: RunCargo = (args, env, cwd) => execFileSync("cargo", [...args],
  { encoding: "utf8", env, cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

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
  const env: Record<string, string> = { ...RELEASE_BUILD.environment,
    CARGO_TARGET_DIR: resolve(root, RELEASE_BUILD.targetDirectory) };
  for (const name of RELEASE_BUILD.inherited) {
    const value = inherited[name];
    if (!value) throw new Error(`Release build needs ${name}`);
    env[name] = value;
  }
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
  const bytes = readFileSync(resolve(root, RELEASE_BUILD.artifact));
  try { requireUngatedSyscalls(bytes); }
  catch (error) { rmSync(resolve(root, "build/chain/release"), { recursive: true, force: true }); throw error; }
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
  requireUngatedSyscalls(bytes);
  return { artifactPath: path, artifactSha256: reviewedSha256, artifactBytes: bytes.length };
}
