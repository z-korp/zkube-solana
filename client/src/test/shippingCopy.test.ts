// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const DIST_ASSETS = join(SRC, "../dist/assets");
const FORBIDDEN =
  /\b(?:MagicBlock|ActiveRun|VRF|oracle|PDA|rent|delegat\w*|Solana base layer)\b/i;
const PARKED = new Set([
  "ui/pages/SpectatorScreen.tsx",
  "ui/components/profile/ShareCardSheet.tsx",
  "ui/components/shared/BootReveal.tsx",
]);
const INTERNAL_TOKENS = /^(?:delegated|pda)$/i;

async function authoredSurfaces(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return authoredSurfaces(path);
      return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
    }),
  );
  return files.flat();
}

describe("shipping copy", () => {
  it("shipping_copy_has_no_engineering_terms", async () => {
    const violations: string[] = [];
    for (const file of await authoredSurfaces(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (relative.startsWith("dev/") || PARKED.has(relative)) continue;
      const source = ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node) => {
        const isModulePath =
          ts.isStringLiteral(node) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent));
        if (
          !isModulePath &&
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isJsxText(node)) &&
          !INTERNAL_TOKENS.test(node.text) &&
          FORBIDDEN.test(node.text)
        ) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          violations.push(`${relative}:${line}: ${node.text.trim()}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);

    // validate.sh builds production before running client tests. This second
    // boundary proves the retired copy and DEV-only query entries did not
    // survive Vite's dead-code elimination.
    const bundle = (
      await Promise.all(
        (await readdir(DIST_ASSETS))
          .filter((name) => name.endsWith(".js"))
          .map((name) => readFile(join(DIST_ASSETS, name), "utf8")),
      )
    ).join("\n");
    const retiredCopy = new RegExp(
      [
        ["Resolving MagicBlock", " run"].join(""),
        ["Recovering ActiveRun", " rent"].join(""),
        ["Preparing verified", " opening"].join(""),
        ["Final tier ", "\\d+\\/7"].join(""),
        ["Forget run", " locally"].join(""),
        "[?&](?:recover|player|pda)=",
      ].join("|"),
      "i",
    );
    expect(bundle).not.toMatch(retiredCopy);
  });
});
