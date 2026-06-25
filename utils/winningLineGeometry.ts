import { INITIAL_SIZE } from "@/constants/game";

/** Start and end points of the winning-line overlay, as percentages (0-100). */
export interface WinningLineCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Center of cell `index` as `{ x, y }` percentages (0-100) of the board's
 * grid area. Columns and rows are derived from the flat index
 * (`col = index % size`, `row = index / size`) and each cell's center sits at
 * `(n + 0.5) / size`, so the geometry stays correct at any board size.
 */
export function cellCenter(index: number): { x: number; y: number } {
  const col = index % INITIAL_SIZE;
  const row = Math.floor(index / INITIAL_SIZE);
  const unit = 100 / INITIAL_SIZE;
  return { x: (col + 0.5) * unit, y: (row + 0.5) * unit };
}

/**
 * Endpoints for a line drawn through a winning triple: from the center of its
 * first cell to the center of its last cell. The winning triple is always
 * ordered along the line, so the first and last indices are its two ends, which
 * yields a correct overlay for all eight wins (rows, columns, both diagonals).
 */
export function winningLineCoords(line: readonly number[]): WinningLineCoords {
  const start = cellCenter(line[0]);
  const end = cellCenter(line[line.length - 1]);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
