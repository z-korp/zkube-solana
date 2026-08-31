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
const MONEY_COPY =
  /Kredit|\bSOL\b|Solana|lamport|wallet|Seeker|prize|\bpot\b|payout|claim|ladder|tier|border|dApp Store/i;
const PARKED = new Set([
  "ui/pages/SpectatorScreen.tsx",
  "ui/components/profile/ShareCardSheet.tsx",
  "ui/components/shared/BootReveal.tsx",
]);
const INTERNAL_TOKENS = /^(?:delegated|pda)$/i;
const DECLARED_MONEY_SURFACES = [
  "ui/components/GameOverDialog.tsx",
  "ui/components/arcade/DailyBoard.tsx",
  "ui/components/arcade/DailyBoardsPreview.tsx",
  "ui/components/arcade/DailyMarquee.tsx",
  "ui/components/arcade/DailyStatusPanel.tsx",
  "ui/components/arcade/EnterCoinKey.tsx",
  "ui/components/arena/LeaderboardRow.tsx",
  "ui/components/economy/Coin.tsx",
  "ui/components/economy/KreditCoin.tsx",
  "ui/components/economy/KreditShopSheet.tsx",
  "ui/components/economy/SolMark.tsx",
  "ui/components/economy/TierFrame.tsx",
  "ui/components/profile/ShareCardSheet.tsx",
  "ui/components/settings/SettingsSheet.tsx",
  "ui/components/settlement/GuardianPrizeResult.tsx",
  "ui/components/settlement/InsertCoinSheet.tsx",
  "ui/components/shared/ConnectCta.tsx",
  "ui/components/shared/WalletRecoveryPanel.tsx",
  "ui/navigation/money/ArcadeDockIcon.tsx",
  "ui/pages/ArcadePage.tsx",
  "ui/pages/ProfilePage.tsx",
  "ui/screens/ConnectScreen.tsx",
] as const;

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

function isAuthoredCopy(node: ts.Node, source: ts.SourceFile): boolean {
  if (ts.isJsxText(node)) return true;
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    return false;
  }
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isJsxAttribute(parent)) {
      const name = parent.name.getText(source);
      return ![
        "className",
        "style",
        "id",
        "src",
        "href",
        "fill",
        "stroke",
        "d",
        "rel",
        "target",
      ].includes(name);
    }
    if (
      ts.isPropertyAssignment(parent) &&
      ["className", "classNames"].includes(parent.name.getText(source))
    ) {
      return false;
    }
    if (ts.isJsxExpression(parent)) {
      if (ts.isJsxAttribute(parent.parent)) {
        parent = parent.parent;
        continue;
      }
      return true;
    }
    if (
      ts.isVariableStatement(parent) ||
      ts.isFunctionLike(parent) ||
      ts.isSourceFile(parent)
    ) {
      return false;
    }
    parent = parent.parent;
  }
  return false;
}

describe("shipping copy", () => {
  it("shipping_copy_has_no_engineering_terms", async () => {
    const violations: string[] = [];
    for (const file of await authoredSurfaces(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (relative.startsWith("dev/") || PARKED.has(relative)) continue;
      const text = await readFile(file, "utf8");
      const declaresMoneySurface = text.includes("MONEY_SURFACE_SENTINEL");
      const source = ts.createSourceFile(
        file,
        text,
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
        if (
          !declaresMoneySurface &&
          !isModulePath &&
          isAuthoredCopy(node, source) &&
          MONEY_COPY.test(node.text)
        ) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          violations.push(
            `${relative}:${line}: undeclared money copy: ${node.text.trim()}`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);

    for (const relative of DECLARED_MONEY_SURFACES) {
      expect(await readFile(join(SRC, relative), "utf8"), relative).toContain(
        "MONEY_SURFACE_SENTINEL",
      );
    }

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
