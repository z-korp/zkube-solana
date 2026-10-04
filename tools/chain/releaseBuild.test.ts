import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseOperatorArgs } from "./cli.js";
import { RELEASE_BUILD, RELEASE_GATE, buildRelease, releaseArtifact, type RunCargo } from "./releaseBuild.js";

const scratch = fileURLToPath(new URL("../../build/release-build-tests", import.meta.url));
beforeEach(() => mkdirSync(scratch, { recursive: true }));
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const VERSIONS = `solana-cargo-build-sbf ${RELEASE_BUILD.cargoBuildSbf}\nplatform-tools ${RELEASE_BUILD.platformTools}\nrustc ${RELEASE_BUILD.rustc}\n`;
/** A 64-bit little-endian ELF with no sections, and so no imports, distinct by its fill. */
const elf = (fill: number) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]), Buffer.alloc(58), Buffer.alloc(64, fill)]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The pinned loader's gate, run as the release runs it, in this repository rather than the scratch checkout. */
const repository = fileURLToPath(new URL("../..", import.meta.url));
const loader: RunCargo = (args, env) => execFileSync("cargo", [...args],
  { encoding: "utf8", env, cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
/** The caller's real tools, which the loader's gate needs to run. */
const real = { PATH: process.env.PATH, HOME: process.env.HOME };
/** A gate that deploys anything: the synthetic ELFs below test the build, not the loader. */
const deploys: RunCargo = () => "";

/** cargo, as far as the build asks: its version, one build that writes the ELF, then the loader's gate. */
function tools(versions: string, output: Buffer, rustflags: readonly string[] = RELEASE_BUILD.rustflags, gate = deploys) {
  const calls: { args: readonly string[]; env: Record<string, string>; cwd: string }[] = [];
  const run: RunCargo = (args, env, cwd) => {
    calls.push({ args, env, cwd });
    if (args.includes("--version")) return versions;
    if (args[0] === "run") return gate(args, env, cwd);
    // What cargo leaves behind in the checkout it runs in: the ELF, and the fingerprint of the
    // flags the compiler really got.
    const fingerprint = `${cwd}/${RELEASE_BUILD.targetDirectory}/${RELEASE_BUILD.target}/release/.fingerprint/solana-0123456789abcdef`;
    mkdirSync(fingerprint, { recursive: true });
    writeFileSync(`${fingerprint}/lib-solana.json`, JSON.stringify({ rustc: 1, rustflags }));
    writeFileSync(`${cwd}/${RELEASE_BUILD.artifact}`, output);
    return "";
  };
  return { run, calls };
}
const home = `${scratch}/home`;

// The caller's environment, full of settings that would change the ELF if they reached the compiler.
const inherited = { PATH: "/tools/bin", HOME: home, RUSTFLAGS: "-C opt-level=2", CARGO_ENCODED_RUSTFLAGS: "-Cdebuginfo=2",
  CARGO_BUILD_RUSTFLAGS: "-C lto=off", RUSTC_WRAPPER: "/tmp/wrapper", CARGO_PROFILE_RELEASE_OPT_LEVEL: "1",
  CARGO_BUILD_TARGET: "x86_64-unknown-linux-gnu", RUSTC: "/tmp/rustc", CARGO_TARGET_DIR: "/tmp/elsewhere" };

it("release_build_gives_the_compiler_only_the_recorded_inputs_and_refuses_any_other_flag_set", () => {
  // Nothing of the caller's environment but PATH and HOME reaches cargo.
  const clean = tools(VERSIONS, elf(1));
  buildRelease(scratch, clean.run, inherited);
  for (const call of clean.calls) {
    expect(Object.keys(call.env).filter((name) => !["PATH", "HOME"].includes(name) && name in inherited &&
      call.env[name] === (inherited as Record<string, string>)[name])).toEqual([]);
    expect(call.cwd).toBe(scratch);
  }
  // Flags that reach the compiler some other way show in its fingerprint: the build is refused
  // and leaves no record a deploy plan could read.
  for (const rustflags of [[...RELEASE_BUILD.rustflags, "-C", "opt-level=2"], [], ["-Zremap-cwd-prefix=/src"]]) {
    expect(() => buildRelease(scratch, tools(VERSIONS, elf(3), rustflags).run, inherited))
      .toThrow("compiler flags differ from the pinned build configuration");
    expect(() => releaseArtifact(scratch, hash(elf(3)))).toThrow("No release build found");
  }
  // Any cargo configuration outside the repository is refused before building, whatever it says:
  // flags, a profile as a table or as dotted keys, a target, an environment table, or nothing at all.
  const outside = [`${home}/.cargo/config.toml`, `${home}/.cargo/config`, `${scratch}/../.cargo/config.toml`];
  for (const path of outside) {
    for (const config of ['[build]\nrustflags = ["-C", "opt-level=2"]\n', "[profile.release]\nopt-level = 1\n",
      "profile.release.opt-level = 1\nprofile.release.lto = false\n", '[target.sbpf-solana-solana]\nlinker = "x"\n',
      '[env]\nRUSTFLAGS = "-C opt-level=2"\n', '[alias]\nb = "build"\n', ""]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, config);
      const refused = tools(VERSIONS, elf(1));
      expect(() => buildRelease(scratch, refused.run, inherited)).toThrow("cargo configuration outside the repository");
      expect(refused.calls).toHaveLength(0);
      rmSync(path);
    }
  }
  rmSync(`${scratch}/../.cargo`, { recursive: true, force: true });
  // The repository's own configuration is source, built and reviewed with the rest.
  mkdirSync(`${scratch}/.cargo`, { recursive: true });
  writeFileSync(`${scratch}/.cargo/config.toml`, "[net]\noffline = true\n");
  expect(buildRelease(scratch, tools(VERSIONS, elf(1)).run, inherited).sha256).toBe(hash(elf(1)));
});

it("a_checkout_reached_through_a_symlink_is_checked_and_built_where_it_really_lives", () => {
  // The checkout lives in physical/; the build is given alias/, a symlink to it. Cargo runs in
  // the real checkout and reads configuration above it, so that is checked as well as the
  // directories above the path the build was given.
  const physical = `${scratch}/physical/checkout`, alias = `${scratch}/alias/checkout`;
  mkdirSync(physical, { recursive: true }); mkdirSync(dirname(alias), { recursive: true });
  symlinkSync(physical, alias);
  for (const path of [`${scratch}/physical/.cargo/config.toml`, `${scratch}/physical/.cargo/config`, `${scratch}/alias/.cargo/config.toml`]) {
    for (const config of ["profile.release.opt-level = 1\nprofile.release.lto = false\n", ""]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, config);
      const refused = tools(VERSIONS, elf(1));
      expect(() => buildRelease(alias, refused.run, inherited)).toThrow(`cargo configuration outside the repository: ${path}`);
      expect(refused.calls).toHaveLength(0);
      rmSync(path);
    }
  }
  // With nothing outside, the build runs in the real checkout and records there.
  const built = tools(VERSIONS, elf(4));
  expect(buildRelease(alias, built.run, inherited).sha256).toBe(hash(elf(4)));
  expect(built.calls.map(({ cwd }) => cwd)).toEqual([physical, physical, physical]);
  expect(built.calls.slice(0, 2).every(({ env }) => env.CARGO_TARGET_DIR === `${physical}/${RELEASE_BUILD.targetDirectory}`)).toBe(true);
  expect(built.calls[2]!.args).toEqual([...RELEASE_GATE, `${physical}/${RELEASE_BUILD.artifact}`]);
  expect(releaseArtifact(physical, hash(elf(4)), deploys).artifactSha256).toBe(hash(elf(4)));
});

it("release_build_uses_only_the_pinned_tools_from_a_clean_target_and_records_what_built_it", () => {
  for (const [name, pinned] of [["solana-cargo-build-sbf", RELEASE_BUILD.cargoBuildSbf],
    ["platform-tools", RELEASE_BUILD.platformTools], ["rustc", RELEASE_BUILD.rustc]]) {
    const other = tools(VERSIONS.replace(`${name} ${pinned}`, `${name} 0.0.1`), elf(1));
    expect(() => buildRelease(scratch, other.run, inherited)).toThrow(`Release build needs ${name} ${pinned}; found 0.0.1`);
    // Nothing is built with other tools.
    expect(other.calls).toHaveLength(1);
  }
  // Leftovers of an earlier build never reach the release.
  mkdirSync(`${scratch}/${RELEASE_BUILD.targetDirectory}`, { recursive: true });
  mkdirSync(`${scratch}/build/chain/release`, { recursive: true });
  writeFileSync(`${scratch}/${RELEASE_BUILD.targetDirectory}/stale`, "x");
  writeFileSync(`${scratch}/build/chain/release/stale.so`, "x");
  const { run, calls } = tools(VERSIONS, elf(1));
  const record = buildRelease(scratch, run, inherited);
  expect(() => readFileSync(`${scratch}/${RELEASE_BUILD.targetDirectory}/stale`)).toThrow();
  expect(() => readFileSync(`${scratch}/build/chain/release/stale.so`)).toThrow();
  expect(calls[1]).toEqual({ args: RELEASE_BUILD.arguments, cwd: scratch, env: { PATH: "/tools/bin", HOME: home,
    NO_DNA: "1", CARGO_NET_OFFLINE: "true", CARGO_BUILD_JOBS: "6",
    CARGO_TARGET_DIR: `${scratch}/${RELEASE_BUILD.targetDirectory}` } });
  expect(RELEASE_BUILD.arguments.slice(-2)).toEqual(["--", "--locked"]);
  expect(record).toEqual({ recipe: RELEASE_BUILD, sha256: hash(elf(1)), bytes: elf(1).length });
  expect(parseOperatorArgs(["build-release"])).toEqual({ help: false, mode: "build-release" });
});

it("a_deploy_plan_quotes_only_the_recorded_release_build_at_the_reviewed_hash", () => {
  expect(() => releaseArtifact(scratch, hash(elf(1)))).toThrow("No release build found");
  const record = buildRelease(scratch, tools(VERSIONS, elf(1)).run, inherited);
  expect(releaseArtifact(scratch, record.sha256, deploys)).toEqual({ artifactPath: `${scratch}/${RELEASE_BUILD.artifact}`,
    artifactSha256: record.sha256, artifactBytes: elf(1).length });
  // Another hash than the one built, however obtained, is not this release.
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("differs from release input");
  // An ELF swapped in after the build, even at the same size, is refused.
  writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, elf(2));
  expect(() => releaseArtifact(scratch, record.sha256)).toThrow("changed after it was built");
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("changed after it was built");
  // A build made any other way carries another recipe, or none.
  const path = `${scratch}/build/chain/release/solana.release.json`;
  for (const recipe of [{ ...RELEASE_BUILD, arguments: [...RELEASE_BUILD.arguments, "--disable-remap-cwd"] },
    { ...RELEASE_BUILD, platformTools: "v1.51" }, undefined]) {
    writeFileSync(path, JSON.stringify({ recipe, sha256: hash(elf(2)), bytes: elf(1).length }));
    expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
  }
  writeFileSync(path, "{");
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
});

// The program as built by `anchor build` / `cargo build-sbf` before the suite runs.
const program = fileURLToPath(new URL("../../target/deploy/solana.so", import.meta.url));

/** The section the loader reaches through DT_SYMTAB, in the real program. */
function symbolSection(elf: Buffer): number {
  const at = Number(elf.readBigUInt64LE(0x28)), size = elf.readUInt16LE(0x3a), count = elf.readUInt16LE(0x3c);
  for (let index = 0; index < count; index++) if (elf.readUInt32LE(at + index * size + 4) === 11) return at + index * size;
  throw new Error("no symbol section");
}

/** The PT_DYNAMIC program header. */
function dynamicHeader(elf: Buffer): number {
  const at = Number(elf.readBigUInt64LE(0x20)), size = elf.readUInt16LE(0x36), count = elf.readUInt16LE(0x38);
  for (let index = 0; index < count; index++) if (elf.readUInt32LE(at + index * size) === 2) return at + index * size;
  throw new Error("no PT_DYNAMIC header");
}

/**
 * The program as built and in each symbol encoding audit 11 found a hand-written
 * scanner reading differently from the loader: the symbol section typed SYMTAB,
 * its entry size zero, and an unaligned PT_DYNAMIC header the loader rejects for
 * the SHT_DYNAMIC section.
 */
function encodings(elf: Buffer): [string, Buffer][] {
  const section = symbolSection(elf), header = dynamicHeader(elf);
  const symtab = Buffer.from(elf); symtab.writeUInt32LE(2, section + 4);
  const zeroEntry = Buffer.from(elf); zeroEntry.writeBigUInt64LE(0n, section + 0x38);
  let empty = 65;
  while (!(empty % 8 && elf.subarray(empty, empty + 16).every((byte) => byte === 0))) empty += 2;
  const unaligned = Buffer.from(elf);
  unaligned.writeBigUInt64LE(BigInt(empty), header + 8); unaligned.writeBigUInt64LE(16n, header + 32);
  return [["as built", Buffer.from(elf)], ["symbol section typed SYMTAB", symtab], ["symbol entry size zero", zeroEntry],
    ["unaligned PT_DYNAMIC", unaligned]];
}

/** The same program, its sol_sha256 import renamed to sol_blake3, whose feature gate a cluster may have off. */
function gated(elf: Buffer): Buffer {
  const bytes = Buffer.from(elf), at = bytes.indexOf(Buffer.from("sol_sha256\0"));
  expect(at).toBeGreaterThan(0);
  bytes.write("sol_blake3", at, "latin1");
  return bytes;
}

it("the_release_and_the_plan_deploy_the_program_through_the_loader_with_every_feature_gate_off", () => {
  // Devnet refused to deploy a program importing sol_remaining_compute_units: its
  // feature gate is off there. The release build and the deploy plan both run the
  // pinned loader, and it deploys the program in every encoding.
  for (const [encoding, bytes] of encodings(readFileSync(program))) {
    const record = buildRelease(scratch, tools(VERSIONS, bytes, RELEASE_BUILD.rustflags, loader).run, real);
    expect(record.sha256, encoding).toBe(hash(bytes));
    expect(releaseArtifact(scratch, record.sha256, loader, real).artifactSha256, encoding).toBe(hash(bytes));
  }
}, 600_000);

it("a_release_importing_a_gated_syscall_is_refused_in_every_symbol_encoding_before_it_is_recorded", () => {
  // The loader, not a reading of the ELF, refuses the gated import however the
  // symbols are encoded, and the build records nothing a deploy plan could quote.
  for (const [encoding, bytes] of encodings(gated(readFileSync(program)))) {
    expect(() => buildRelease(scratch, tools(VERSIONS, bytes, RELEASE_BUILD.rustflags, loader).run, real), encoding)
      .toThrow("refused by the pinned loader with every feature gate off");
    expect(() => releaseArtifact(scratch, hash(bytes), loader, real), encoding).toThrow("No release build found");
  }
  // An ELF swapped for a gated one after a recorded build is refused by the plan too.
  const record = buildRelease(scratch, tools(VERSIONS, readFileSync(program), RELEASE_BUILD.rustflags, loader).run, real);
  const swapped = gated(readFileSync(program));
  writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, swapped);
  writeFileSync(`${scratch}/build/chain/release/solana.release.json`,
    JSON.stringify({ recipe: RELEASE_BUILD, sha256: hash(swapped), bytes: swapped.length }));
  expect(record.sha256).not.toBe(hash(swapped));
  expect(() => releaseArtifact(scratch, hash(swapped), loader, real)).toThrow("refused by the pinned loader");
  // A file that is not a program is refused, never taken to import nothing.
  writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, "not an elf");
  writeFileSync(`${scratch}/build/chain/release/solana.release.json`,
    JSON.stringify({ recipe: RELEASE_BUILD, sha256: hash(Buffer.from("not an elf")), bytes: 10 }));
  expect(() => releaseArtifact(scratch, hash(Buffer.from("not an elf")), loader, real)).toThrow("refused by the pinned loader");
}, 600_000);
