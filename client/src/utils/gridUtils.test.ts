import { describe, expect, it } from "vitest";
import {
  reconcileBlocksToGrid,
  transformDataContractIntoBlock,
} from "./gridUtils";
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

describe("transformDataContractIntoBlock", () => {
  it("should transform a row with empty spaces and blocks", () => {
    const input: number[][] = [[0, 0, 1, 2, 2, 3, 3, 3]];
    const result = transformDataContractIntoBlock(input);

    expect(result).toHaveLength(3);
    // Block of width 1
    expect(result[0]).toMatchObject({
      x: 2,
      y: 0,
      width: 1,
    });
    // Block of width 2
    expect(result[1]).toMatchObject({
      x: 3,
      y: 0,
      width: 2,
    });
    // Block of width 3
    expect(result[2]).toMatchObject({
      x: 5,
      y: 0,
      width: 3,
    });
  });

  it("should handle multiple blocks of the same width", () => {
    const input: number[][] = [[2, 2, 0, 2, 2, 0, 2, 2]];
    const result = transformDataContractIntoBlock(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 2,
    });
    expect(result[1]).toMatchObject({
      x: 3,
      y: 0,
      width: 2,
    });
    expect(result[2]).toMatchObject({
      x: 6,
      y: 0,
      width: 2,
    });
  });

  it("should handle multiple rows", () => {
    const input: number[][] = [
      [0, 0, 1, 2, 2, 3, 3, 3],
      [2, 2, 0, 0, 2, 2, 0, 0],
      [3, 3, 3, 0, 0, 2, 2, 0],
    ];
    const result = transformDataContractIntoBlock(input);

    expect(result).toHaveLength(7);

    // First row
    expect(result[0]).toMatchObject({
      x: 2,
      y: 0,
      width: 1,
    });
    expect(result[1]).toMatchObject({
      x: 3,
      y: 0,
      width: 2,
    });
    expect(result[2]).toMatchObject({
      x: 5,
      y: 0,
      width: 3,
    });

    // Second row
    expect(result[3]).toMatchObject({
      x: 0,
      y: 1,
      width: 2,
    });
    expect(result[4]).toMatchObject({
      x: 4,
      y: 1,
      width: 2,
    });

    // Third row
    expect(result[5]).toMatchObject({
      x: 0,
      y: 2,
      width: 3,
    });
    expect(result[6]).toMatchObject({
      x: 5,
      y: 2,
      width: 2,
    });
  });
});

describe("transformDataContractIntoBlock", () => {
  it("should handle grid pattern with blocks of different widths", () => {
    const input: number[][] = [
      [0, 2, 2, 2, 2, 0, 0, 0], // One block of width 2 starting at x=1 and one block of width 2 starting at x=3
      [0, 1, 3, 3, 3, 0, 0, 0], // One block of width 1 at x=1, one block of width 3 at x=2
      [1, 2, 2, 0, 2, 2, 0, 0], // One block of width 1 at x=0, two blocks of width 2 at x=1 and x=4
    ];

    const result = transformDataContractIntoBlock(input);

    expect(result).toHaveLength(7); // Total number of blocks

    // First row: [0, 2, 2, 2, 2, 0, 0, 0]
    expect(result[0]).toMatchObject({
      x: 1,
      y: 0,
      width: 2,
    });

    expect(result[1]).toMatchObject({
      x: 3,
      y: 0,
      width: 2,
    });

    // Second row: [0, 1, 3, 3, 3, 0, 0, 0]
    expect(result[2]).toMatchObject({
      x: 1,
      y: 1,
      width: 1,
    });
    expect(result[3]).toMatchObject({
      x: 2,
      y: 1,
      width: 3,
    });

    // Third row: [1, 2, 2, 0, 2, 2, 0, 0]
    expect(result[4]).toMatchObject({
      x: 0,
      y: 2,
      width: 1,
    });
    expect(result[5]).toMatchObject({
      x: 1,
      y: 2,
      width: 2,
    });
    expect(result[6]).toMatchObject({
      x: 4,
      y: 2,
      width: 2,
    });
  });
});
