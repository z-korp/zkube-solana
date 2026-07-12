import { describe, expect, it } from "vitest";
import fixtures from "../../../fixtures/game-parity.json";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import { BOSS_IDENTITIES } from "@/config/bossIdentities";

describe("shared game parity fixtures", () => {
  it("renders every coherent Rust/Cairo row as the same block entities", () => {
    for (const fixture of fixtures.validRows) {
      const blocks = transformDataContractIntoBlock([fixture.cells]);
      expect(
        blocks.map(({ x, width }) => ({ x, width })),
        fixture.name,
      ).toEqual(fixture.blocks);
    }
  });

  it("renders every golden operation result without changing block entities", () => {
    for (const fixture of fixtures.gridCases) {
      for (const expected of fixture.expectedRows) {
        const reconstructed = Array(8).fill(0);
        for (const block of transformDataContractIntoBlock([expected.cells])) {
          reconstructed.fill(block.width, block.x, block.x + block.width);
        }
        expect(reconstructed, fixture.name).toEqual(expected.cells);
      }
    }
  });

  it("keeps the canonical boss identity attached to each Rust map snapshot", () => {
    for (const map of fixtures.mapCatalog) {
      expect(BOSS_IDENTITIES[map.bossId]?.name, `map ${map.mapId}`).toBe(map.bossName);
    }
  });
});
