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
 * Fraction of the half-cell between an end cell's center and its outer edge to
 * push each endpoint outward past that center: `0` keeps the line center to
 * center, `1` reaches the end cells' outer edges. We extend most of the way so
 * the line reaches well into both end cells (closer to their outer edges)
 * without quite touching the board boundary.
 */
const ENDPOINT_EXTEND = 0.7;

/**
 * Endpoints for a line drawn through a winning triple, extended outward past the
 * first and last cells' centers toward those cells' outer edges. The winning
 * triple is always ordered along the line, so the first and last indices are its
 * two ends, which yields a correct overlay for all eight wins (rows, columns,
 * both diagonals).
 *
 * The center-to-center vector spans two cells, so a quarter of it is the
 * half-cell distance from an end cell's center to its outer edge. Each endpoint
 * is pushed out by that quarter, scaled by `ENDPOINT_EXTEND`, along the same
 * line - so it stays resize-safe (everything is percentages) for every
 * orientation.
 */
export function winningLineCoords(line: readonly number[]): WinningLineCoords {
  const start = cellCenter(line[0]);
  const end = cellCenter(line[line.length - 1]);
  const ext = ENDPOINT_EXTEND * 0.25;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    x1: start.x - dx * ext,
    y1: start.y - dy * ext,
    x2: end.x + dx * ext,
    y2: end.y + dy * ext,
  };
}
