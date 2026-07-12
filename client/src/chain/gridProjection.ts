const ROWS = 10;
const COLS = 8;

export function toDisplayGrid(cells: number[]): number[][] {
  const rows = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let index = 0; index < Math.min(cells.length, ROWS * COLS); index += 1) {
    const row = Math.floor(index / COLS);
    rows[ROWS - 1 - row][index % COLS] = cells[index];
  }
  return rows;
}
