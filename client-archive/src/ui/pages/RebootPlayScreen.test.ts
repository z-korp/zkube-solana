// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toDisplayGrid } from "@/solana/reboot/rebootGrid";

describe("RebootPlayScreen account projection", () => {
  it("maps the engine's bottom-first row order into the retained top-first renderer", () => {
    const cells = new Array(80).fill(0);
    cells.splice(0, 8, 1, 0, 2, 2, 0, 0, 0, 0);
    cells.splice(72, 8, 0, 3, 3, 3, 0, 0, 0, 0);
    const grid = toDisplayGrid(cells);
    expect(grid[9]).toEqual([1, 0, 2, 2, 0, 0, 0, 0]);
    expect(grid[0]).toEqual([0, 3, 3, 3, 0, 0, 0, 0]);
  });
});
