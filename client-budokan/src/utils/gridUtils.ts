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

export const blocksMatchGrid = (
  blocks: Block[],
  grid: number[][]
): boolean => {
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (matrix[y][x] !== grid[y][x]) return false;
    }
  }
  return true;
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
