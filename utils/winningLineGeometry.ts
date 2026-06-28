/** Start and end points of the winning-line overlay, as percentages (0-100). */
export interface WinningLineCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Center of cell `index` on a `size`×`size` board as `{ x, y }` percentages
 * (0-100) of the board's grid area. Columns and rows are derived from the flat
 * index (`col = index % size`, `row = index / size`) and each cell's center sits
 * at `(n + 0.5) / size`, so the geometry stays correct at any board size.
 */
export function cellCenter(
  index: number,
  size: number,
): { x: number; y: number } {
  const col = index % size;
  const row = Math.floor(index / size);
  const unit = 100 / size;
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
 * Endpoints for a line drawn through a winning run, extended outward past the
 * first and last cells' centers toward those cells' outer edges. The winning run
 * is always ordered along the line, so the first and last indices are its two
 * ends, which yields a correct overlay for every win (rows, columns, both
 * diagonals) at any board size and run length.
 *
 * The center-to-center vector spans `line.length - 1` cells, so a half-cell - the
 * distance from an end cell's center to its outer edge - is `0.5 / (length - 1)`
 * of it. Each endpoint is pushed out by that half-cell, scaled by
 * `ENDPOINT_EXTEND`, along the same line; dividing by the run length keeps the
 * overshoot a fixed fraction of a single cell rather than of the whole run, so a
 * longer run (e.g. 4-in-a-row) no longer shoots past the board edge. Everything
 * is percentages, so it stays resize-safe for every orientation.
 */
export function winningLineCoords(
  line: readonly number[],
  size: number,
): WinningLineCoords {
  const start = cellCenter(line[0], size);
  const end = cellCenter(line[line.length - 1], size);
  const ext = (ENDPOINT_EXTEND * 0.5) / (line.length - 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    x1: start.x - dx * ext,
    y1: start.y - dy * ext,
    x2: end.x + dx * ext,
    y2: end.y + dy * ext,
  };
}
