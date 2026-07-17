// @vitest-environment node
import { describe, expect, it } from "vitest";
import { reconcileBlocksToGrid } from "./gridUtils";
import type { Block } from "@/types/types";

const emptyGrid = (): number[][] =>
  Array.from({ length: 10 }, () => Array(8).fill(0));

/** Test assertion helper: does the block set render exactly this grid? */
const blocksMatchGrid = (blocks: Block[], grid: number[][]): boolean => {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const matrix = Array.from({ length: height }, () => Array(width).fill(0));
  for (const block of blocks) {
    if (block.y < 0 || block.y >= height) return false;
    for (let i = 0; i < block.width; i++) {
      const x = block.x + i;
      if (x < 0 || x >= width) return false;
      matrix[block.y][x] = block.width;
    }
  }
  return matrix.every((row, y) => row.every((cell, x) => cell === grid[y][x]));
};

describe("reconcileBlocksToGrid", () => {
  it("always renders the chain grid exactly (no divergence possible)", () => {
    const grid = emptyGrid();
    grid[8][2] = 1;
    grid[9][0] = 2;
    grid[9][1] = 2;
    const current = [{ id: 100, x: 2, y: 9, width: 1 }];
    const result = reconcileBlocksToGrid(current, grid);
    expect(blocksMatchGrid(result, grid)).toBe(true);
  });

  it("reuses the id of a persisting block so it animates to the new row", () => {
    // The floor block was pushed up one row by the freshly inserted floor row.
    const grid = emptyGrid();
    grid[8][2] = 1; // the block, now one row higher
    grid[9][0] = 2;
    grid[9][1] = 2; // the new floor row
    const current = [{ id: 100, x: 2, y: 9, width: 1 }];
    const result = reconcileBlocksToGrid(current, grid);
    const shifted = result.find((b) => b.x === 2 && b.y === 8);
    const inserted = result.find((b) => b.x === 0 && b.y === 9);
    expect(shifted?.id).toBe(100); // same element → CSS tween
    expect(inserted).toBeDefined();
    expect(inserted?.id).not.toBe(100); // new row is a fresh block
  });

  it("matches same-column same-width blocks by nearest row", () => {
    const grid = emptyGrid();
    grid[4][0] = 1;
    grid[7][0] = 1;
    const current = [
      { id: 1, x: 0, y: 5, width: 1 },
      { id: 2, x: 0, y: 8, width: 1 },
    ];
    const result = reconcileBlocksToGrid(current, grid);
    expect(result.find((b) => b.y === 4)?.id).toBe(1);
    expect(result.find((b) => b.y === 7)?.id).toBe(2);
  });

  it("preserves every id when the board is unchanged", () => {
    const grid = emptyGrid();
    grid[9][0] = 2;
    grid[9][1] = 2;
    grid[8][5] = 1;
    const current = [
      { id: 11, x: 0, y: 9, width: 2 },
      { id: 22, x: 5, y: 8, width: 1 },
    ];
    const result = reconcileBlocksToGrid(current, grid);
    expect(blocksMatchGrid(result, grid)).toBe(true);
    expect(result.find((b) => b.x === 0 && b.y === 9)?.id).toBe(11);
    expect(result.find((b) => b.x === 5 && b.y === 8)?.id).toBe(22);
  });
});
