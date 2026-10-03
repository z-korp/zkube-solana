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

/**
 * The syscalls an SBF ELF imports, found the way the pinned loader finds them
 * (solana-sbpf 0.12.2, elf_parser parse_dynamic and Elf relocate): the dynamic
 * table from PT_DYNAMIC, else the SHT_DYNAMIC section; its DT_REL relocations;
 * the symbol table at DT_SYMTAB, which may be SYMTAB or DYNSYM and is read in
 * whole 24-byte entries; names from .dynstr. Every R_BPF_64_32 call whose
 * symbol is not a defined function is a syscall the loader must resolve. A
 * file this cannot read is refused, never taken to import nothing; one with
 * no dynamic table is static and imports nothing, as the loader sees it.
 */
export function importedSyscalls(elf: Buffer): string[] {
  const refuse = (why: string): never => { throw new Error(`Release imports cannot be read as the loader reads them: ${why}`); };
  const u64 = (at: number) => {
    if (at < 0 || at + 8 > elf.length) refuse("out of bounds");
    const value = elf.readBigUInt64LE(at);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) refuse("value out of range");
    return Number(value);
  };
  const u32 = (at: number) => { if (at < 0 || at + 4 > elf.length) refuse("out of bounds"); return elf.readUInt32LE(at); };
  const u16 = (at: number) => { if (at < 0 || at + 2 > elf.length) refuse("out of bounds"); return elf.readUInt16LE(at); };
  if (elf.length < 64 || !elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || elf[4] !== 2 || elf[5] !== 1) {
    throw new Error("Release artifact is not a little-endian 64-bit ELF");
  }
  const within = (offset: number, size: number) => {
    if (offset < 0 || size < 0 || offset + size > elf.length) refuse("a table lies outside the file");
  };
  // Program and section headers.
  const programsAt = u64(0x20), programSize = u16(0x36), programCount = u16(0x38);
  const sectionsAt = u64(0x28), sectionSize = u16(0x3a), sectionCount = u16(0x3c), namesIndex = u16(0x3e);
  if (programCount && programSize !== 56) refuse("program header size");
  if (sectionCount && sectionSize !== 64) refuse("section header size");
  within(programsAt, programCount * programSize); within(sectionsAt, sectionCount * sectionSize);
  const programs = Array.from({ length: programCount }, (_, index) => {
    const at = programsAt + index * 56;
    return { type: u32(at), offset: u64(at + 8), vaddr: u64(at + 16), filesz: u64(at + 32), memsz: u64(at + 40) };
  });
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const at = sectionsAt + index * 64;
    return { name: u32(at), type: u32(at + 4), addr: u64(at + 16), offset: u64(at + 24), size: u64(at + 32), link: u32(at + 40) };
  });
  const sectionName = (index: number) => {
    const names = sections[namesIndex];
    if (!names || names.type !== 3) refuse("no section name table");
    const start = names!.offset + sections[index]!.name, end = elf.indexOf(0, start);
    if (end < 0 || end > names!.offset + names!.size) refuse("unterminated section name");
    return elf.toString("latin1", start, end);
  };
  // The dynamic table: PT_DYNAMIC (2) if it reads, else SHT_DYNAMIC (6).
  let dynamic: { offset: number; size: number } | undefined;
  const header = programs.find((program) => program.type === 2);
  if (header && header.offset + header.filesz <= elf.length && header.filesz % 16 === 0) dynamic = { offset: header.offset, size: header.filesz };
  if (!dynamic) {
    const table = sections.find((section) => section.type === 6);
    if (table) { within(table.offset, table.size); if (table.size % 16) refuse("dynamic table size"); dynamic = table; }
  }
  if (!dynamic) return [];
  const tags = new Map<number, number>();
  for (let at = dynamic.offset; at + 16 <= dynamic.offset + dynamic.size; at += 16) {
    const tag = u64(at);
    if (tag === 0) break;
    if (tag < 35) tags.set(tag, u64(at + 8));
  }
  const relocations = tags.get(17) ?? 0;
  if (!relocations) return [];
  if (tags.get(19) !== 16) refuse("relocation entry size");
  const relocationBytes = tags.get(18) ?? 0;
  if (!relocationBytes || relocationBytes % 16) refuse("relocation table size");
  const inProgram = programs.find((program) => relocations >= program.vaddr && relocations < program.vaddr + program.memsz);
  const relocationsAt = inProgram ? relocations - inProgram.vaddr + inProgram.offset
    : sections.find((section) => section.addr === relocations)?.offset ?? refuse("relocation table not found");
  within(relocationsAt, relocationBytes);
  // The symbol table at DT_SYMTAB, SYMTAB (2) or DYNSYM (11), and .dynstr.
  const symbolsAddress = tags.get(6) ?? 0;
  const symbols = symbolsAddress ? sections.find((section) => section.addr === symbolsAddress) : undefined;
  if (symbolsAddress && !symbols) refuse("symbol table not found");
  if (symbols && symbols.type !== 2 && symbols.type !== 11) refuse("symbol table type");
  if (symbols) { within(symbols.offset, symbols.size); if (symbols.size % 24) refuse("symbol table size"); }
  const strings = sections.find((_, index) => sectionName(index) === ".dynstr");
  const names = new Set<string>();
  for (let at = relocationsAt; at < relocationsAt + relocationBytes; at += 16) {
    const info = u64(at + 8), type = info % 2 ** 32, index = Math.floor(info / 2 ** 32);
    if (type !== 10) continue; // R_BPF_64_32: a call to a symbol
    if (!symbols || (index + 1) * 24 > symbols.size) refuse("a call names a symbol that is not there");
    const entry = symbols!.offset + index * 24;
    const name = u32(entry), function_ = (elf[entry + 4]! & 0xf) === 2, value = u64(entry + 8);
    if (function_ && value !== 0) continue; // a call inside the program
    if (!strings || strings.type !== 3) refuse("no dynamic string table");
    const start = strings!.offset + name, end = elf.indexOf(0, start);
    if (end < 0 || end > strings!.offset + strings!.size) refuse("unterminated symbol name");
    names.add(elf.toString("latin1", start, end));
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
