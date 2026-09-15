import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { generateProvisionalBoardFixtures } from "./provisional-board-fixtures";
import { canonicalJson, repositoryRoot } from "./solana-fixtures";

test("provisional rows match the existing keeper adapter's real scanner and comparator", async () => {
  const network = vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw new Error("Unexpected network");});
  try {
    const fixture=await generateProvisionalBoardFixtures(), output=canonicalJson(fixture);
    expect(canonicalJson(await generateProvisionalBoardFixtures())).toBe(output);
    expect(fixture.score).toHaveLength(5); expect(fixture.theme).toHaveLength(4);
    expect(fixture.score.map(row=>row.owner).slice(2,4)).toEqual(fixture.rawWalletTie);
    expect(fixture.rawWalletTie[0]!>fixture.rawWalletTie[1]!).toBe(true);
    expect(fixture.score.every(row=>row.score>0)).toBe(true);
    expect(fixture.theme.every(row=>BigInt(row.objectiveTotal)>0n)).toBe(true);
    expect(fixture.score.at(-1)?.finalizedAt).toBe(fixture.timestampBoundary.maximumAccepted);
    expect(fixture.timestampBoundary.invalidCases).toHaveLength(2);
    const path=resolve(repositoryRoot,"fixtures/unity-provisional-boards-v1.json");
    if(process.env.ZKUBE_WRITE_UNITY_FIXTURES==="1"&&(!existsSync(path)||readFileSync(path,"utf8")!==output))writeFileSync(path,output);
    expect(readFileSync(path,"utf8")).toBe(output); expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
});
