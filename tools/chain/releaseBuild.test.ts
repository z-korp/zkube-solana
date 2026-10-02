import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { parseOperatorArgs } from "./cli.js";
import { RELEASE_BUILD, buildRelease, releaseArtifact, type RunCargo } from "./releaseBuild.js";

const scratch = fileURLToPath(new URL("../../build/release-build-tests", import.meta.url));
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const VERSIONS = `solana-cargo-build-sbf ${RELEASE_BUILD.cargoBuildSbf}\nplatform-tools ${RELEASE_BUILD.platformTools}\nrustc ${RELEASE_BUILD.rustc}\n`;
const elf = (fill: number) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, fill)]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** cargo, as far as the build asks: its version, then one build that writes the ELF. */
function tools(versions: string, output: Buffer, rustflags: readonly string[] = RELEASE_BUILD.rustflags) {
  const calls: { args: readonly string[]; env: Record<string, string>; cwd: string }[] = [];
  const run: RunCargo = (args, env, cwd) => {
    calls.push({ args, env, cwd });
    if (args.includes("--version")) return versions;
    // What cargo leaves behind: the ELF, and the fingerprint of the flags the compiler really got.
    const fingerprint = `${scratch}/${RELEASE_BUILD.targetDirectory}/${RELEASE_BUILD.target}/release/.fingerprint/solana-0123456789abcdef`;
    mkdirSync(fingerprint, { recursive: true });
    writeFileSync(`${fingerprint}/lib-solana.json`, JSON.stringify({ rustc: 1, rustflags }));
    writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, output);
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
  expect(record).toEqual({ recipe: RELEASE_BUILD, sha256: hash(elf(1)), bytes: 68 });
  expect(parseOperatorArgs(["build-release"])).toEqual({ help: false, mode: "build-release" });
});

it("a_deploy_plan_quotes_only_the_recorded_release_build_at_the_reviewed_hash", () => {
  expect(() => releaseArtifact(scratch, hash(elf(1)))).toThrow("No release build found");
  const record = buildRelease(scratch, tools(VERSIONS, elf(1)).run, inherited);
  expect(releaseArtifact(scratch, record.sha256)).toEqual({ artifactPath: `${scratch}/${RELEASE_BUILD.artifact}`,
    artifactSha256: record.sha256, artifactBytes: 68 });
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
    writeFileSync(path, JSON.stringify({ recipe, sha256: hash(elf(2)), bytes: 68 }));
    expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
  }
  writeFileSync(path, "{");
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
});
