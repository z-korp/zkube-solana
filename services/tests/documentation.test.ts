// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dailyWindow } from "../src/zkubeCore.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function declaredNames(source: string): Set<string> {
  source = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  const names = new Set<string>();
  const patterns = [
    /\b(?:fn|def|fun|class|struct|enum|interface|trait)\s+(\w+)/g,
    /\b(?:const|static)\s+(?!fn\b)(\w+)/g,
    /\b(?:public|private|internal|protected)\s+(?:(?:static|async|override|sealed|virtual)\s+)*(?:[\w.]+(?:<[^;{}\n]+>)?(?:\[\])?)\s+(\w+)\s*\(/g,
    /\b(?:it|test|describe)(?:\.each\([^;]*?\))?\s*\(\s*["'`]([^"'`\n]+)["'`]/g,
    // Golden replay tests are emitted by this macro with an identifier argument.
    /golden_run_test!\s*\(\s*(\w+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]!);
  }
  return names;
}

function references(document: string): string[] {
  return [...new Set([...document.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`]+)`/g)]
    .map(match => match[1]!.replace(/\s+/g, " ")))];
}

describe("specification references", () => {
  it("every_backticked_spec_identifier_resolves_in_the_tree", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
    const paths = new Set<string>();
    const names = new Set<string>();
    for (const file of new Set(files)) {
      paths.add(file);
      for (let parent = dirname(file); parent !== "."; parent = dirname(parent)) paths.add(parent);
      if (!/\.(?:rs|cs|ts|py|kt|mjs)$/.test(file)) continue;
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const name of declaredNames(source)) names.add(name);
    }
    // RPC operation names are declarations of the wire protocol in its adapter.
    const rpc = readFileSync(join(ROOT, "unity/Assets/ZKube/Integration/Transport/SolanaRpcTransport.cs"), "utf8");
    for (const match of rpc.matchAll(/"(get[A-Z]\w+)"/g)) names.add(match[1]!);
    const document = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const missing = references(document).filter(reference => !names.has(reference) && !paths.has(reference));
    expect(missing).toEqual([]);
  });

  it("every_utc_clock_time_in_authored_text_is_the_cores_day_window", () => {
    // The core owns when a day opens and when its entries close. Any clock
    // time written beside "UTC" must be one of those two, read from the core.
    const clock = (unix: number) => new Date(unix * 1_000).toISOString().slice(11, 16);
    const window = dailyWindow(20_705);
    const allowed = new Set([clock(window.opensAt), clock(window.runsCloseAt)]);
    expect(allowed).toEqual(new Set(["07:00", "06:59"]));
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, encoding: "utf8" }).split("\0")
      .filter(file => /\.(?:md|rs|cs|ts|py|kt|mjs)$/.test(file));
    const stray: string[] = [];
    for (const file of new Set(files)) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(/\b(\d{1,2}:\d{2})(?::\d{2})?\s*UTC\b/g))
        if (!allowed.has(match[1]!.padStart(5, "0"))) stray.push(`${file}: ${match[0]}`);
    }
    expect(stray).toEqual([]);
  });

  it("reference_extraction_requires_a_declaration_and_ignores_command_blocks", () => {
    const names = declaredNames('public void ExistingGuard() {}\nconst fn core_guard() {}\nit("copy rule", () => {});\n// fn RemovedGuard()');
    expect(names.has("ExistingGuard")).toBe(true);
    expect(names.has("core_guard")).toBe(true);
    expect(names.has("copy rule")).toBe(true);
    expect(names.has("RemovedGuard")).toBe(false);
    expect(references('Guard `ExistingGuard`.\n```sh\n`command`\n```')).toEqual(["ExistingGuard"]);
    expect(references('Guard `copy\nrule`.')).toEqual(["copy rule"]);
  });
});
