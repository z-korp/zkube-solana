import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));
const scripts = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).scripts as Record<string, string>;

describe("chain_entrypoints_load_offline_under_tsx", () => {
  for (const [name, command] of Object.entries(scripts)) {
    if (name !== "chain") continue;
    it(name, () => {
      const [runner, entry] = command.split(" ");
      expect(runner).toBe("tsx");
      const output = execFileSync(process.execPath, ["--import", "tsx", entry!, "--help"], {
        cwd: root, encoding: "utf8", timeout: 15000,
        env: { PATH: process.env.PATH, NO_DNA: "1" },
      });
      expect(output.trim().length).toBeGreaterThan(0);
    });
  }
});
