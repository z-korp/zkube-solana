import type { Block } from "@/types/types";

const transformToGridFormat = (
  blocks: Block[],
  gridWidth: number,
  gridHeight: number
): number[][] => {
  const grid = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(0)
  );

  blocks.forEach((block) => {
    for (let i = 0; i < block.width; i++) {
      grid[block.y][block.x + i] = block.id;
    }
  });

  return grid;
};

export const removeCompleteRows = (
  blocks: Block[],
  gridWidth: number,
  gridHeight: number
): { updatedBlocks: Block[]; completeRows: number[] } => {
  const grid = transformToGridFormat(blocks, gridWidth, gridHeight);

  const completeRows = grid
    .map((row, index) => (row.every((cell) => cell !== 0) ? index : -1))
    .filter((index) => index !== -1);

  const updatedBlocks = blocks.filter((block) => {
    return !completeRows.some((rowIndex) => block.y === rowIndex);
  });

  return { updatedBlocks, completeRows };
};

let _blockIdCounter = 0;

export const transformDataContractIntoBlock = (grid: number[][]): Block[] => {
  return grid.flatMap((row, y) => {
    const blocks: Block[] = [];
    let x = 0;

    while (x < row.length) {
      const currentValue = row[x];
      if (currentValue > 0) {
        blocks.push({
          id: ++_blockIdCounter,
          x,
          y,
          width: currentValue,
        });
        x += currentValue;
      } else {
        x++;
      }
    }

    return blocks;
  });
};

/**
 * Reconcile the currently-rendered blocks onto the authoritative chain grid.
 *
 * The returned list represents the chain grid EXACTLY (same occupied cells and
 * widths), so the visible board can never diverge from the chain. The only
 * thing carried over from `current` is block identity: a target block reuses
 * the id of a current block with the same column (x) and width, choosing the
 * nearest row — so React keeps the same element and CSS transitions animate the
 * fall/shift. Genuinely new cells (e.g. the freshly inserted floor row) keep
 * their fresh id and simply appear. Cleared/shifted-out blocks are dropped.
 *
 * Vertical gravity, line clears and the bottom-row insert never change a
 * block's column, so matching on exact x is sound; the swipe (the only
 * horizontal move) has already been applied to both `current` and the grid.
 */
export const reconcileBlocksToGrid = (
  current: Block[],
  grid: number[][]
): Block[] => {
  const targets = transformDataContractIntoBlock(grid);
  const used = new Set<number>();
  return targets.map((target) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    current.forEach((block, index) => {
      if (used.has(index)) return;
      if (block.width !== target.width || block.x !== target.x) return;
      const distance = Math.abs(block.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      return { ...target, id: current[bestIndex].id };
    }
    return target;
  });
};

export const removeBlocksSameWidth = (
  block: Block,
  blocks: Block[]
): Block[] => {
  return blocks.filter((b) => b.width !== block.width);
};

export const removeBlocksInRows = (
  rows: number[],
  blocks: Block[]
): Block[] => {
  const rowSet = new Set(rows);
  return blocks.filter((b) => !rowSet.has(b.y));
};
