import { INITIAL_SIZE } from "@/constants/game";

export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[];

/** Directions O can slide the grid with its one-time shift action. */
export type Direction = "top" | "bottom" | "left" | "right";
export const DIRECTIONS: readonly Direction[] = [
  "top",
  "bottom",
  "left",
  "right",
];

/**
 * How O's shift moves the grid (a POC-configurable rule variant):
 * - "classic": rigid translation by exactly one cell (the original behaviour);
 *   marks pushed off the leading edge are removed and the shift can never win.
 * - "collapse": each line is translated toward the leading edge until the edge
 *   cell's value changes (a distance equal to the run of cells matching the edge
 *   value). An empty edge pulls the line in to fill the gap; an occupied edge
 *   sheds its leading run of matching marks off the board and brings the first
 *   differing mark to the edge. Unlike "classic", this can complete a line, so
 *   the store settles the game after a collapse shift.
 *
 * The active mode is chosen server-side (see `lib/gameConfig.ts`) and recorded
 * on each shift action, so it only governs *new* shifts and never rewrites
 * history - replays and completed-game rebuilds always use the mode the shift
 * was actually played with.
 */
export type ShiftMode = "classic" | "collapse";
export const SHIFT_MODES: readonly ShiftMode[] = ["classic", "collapse"];

/** Mode used for shift actions recorded before the POC variant existed. */
export const DEFAULT_SHIFT_MODE: ShiftMode = "classic";

/**
 * One turn's action. Players alternate strictly - X takes the even-indexed
 * actions, O the odd ones - and on a turn a player either places a mark or, as
 * O's once-per-game option, shifts the whole grid (which uses up the turn
 * instead of placing). A shift carries the `mode` it was played with (absent on
 * legacy actions, which default to "classic"). The ordered action list is a
 * game's single source of truth, so replaying any prefix of it rebuilds the
 * board exactly.
 */
export type GameAction =
  | { kind: "place"; index: number }
  | { kind: "shift"; dir: Direction; mode?: ShiftMode };

export interface WinnerResult {
  winner: Player;
  line: [number, number, number];
}

/**
 * The eight winning triples of the fixed 3×3 board, as flat cell indices: the
 * three rows, the three columns, then the two diagonals.
 */
const WINNING_LINES: readonly [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * Returns the winning player and the line that won, or null if there is no
 * winner yet. A win is always three in a row.
 */
export function calculateWinner(board: Board): WinnerResult | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] as Player, line };
    }
  }
  return null;
}

/** True when every cell is filled. */
export function isBoardFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

/** True when the game is over (someone won or the board is full). */
export function isGameOver(board: Board): boolean {
  return calculateWinner(board) !== null || isBoardFull(board);
}

export function otherPlayer(player: Player): Player {
  return player === "X" ? "O" : "X";
}

/**
 * Slide the whole grid in `direction` using the given shift `mode`. This is O's
 * once-per-game shift action; see `ShiftMode` for how the variants differ.
 * Derived from `shiftPlan` (the single source of truth for where each mark
 * goes): every surviving mark lands on its planned cell and swept-off marks are
 * dropped. Returns a fresh board; the input is not mutated.
 */
export function shiftBoard(
  board: Board,
  direction: Direction,
  mode: ShiftMode = DEFAULT_SHIFT_MODE,
): Board {
  const size = INITIAL_SIZE;
  const next: Board = Array(size * size).fill(null);
  for (const motion of shiftPlan(board, direction, mode)) {
    if (motion.departs) continue;
    next[motion.to.row * size + motion.to.col] = motion.player;
  }
  return next;
}

/** A row/column coordinate; may be off-grid (negative or ≥ size) for a mark a
 *  shift sweeps away, so the UI can slide it past the edge. */
export interface CellCoord {
  row: number;
  col: number;
}

/**
 * How a single mark moves under a shift: from its current cell `from` to `to`.
 * `to` is an in-grid cell when the mark survives, or an off-grid coordinate (in
 * the shift direction) when `departs` is true - the mark the shift removes.
 */
export interface ShiftMotion {
  player: Player;
  from: CellCoord;
  to: CellCoord;
  departs: boolean;
}

/**
 * Unit row/column step for each shift direction - the single source of truth for
 * the per-direction movement vector, shared by the shift transform here and the
 * board's shift animation in the UI.
 */
export const DIRECTION_STEPS: Record<Direction, readonly [number, number]> = {
  top: [-1, 0],
  bottom: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/**
 * The per-mark motion a shift produces - the single source of truth for the
 * shift transform. `shiftBoard` applies it to rebuild the board, and the UI uses
 * it to animate each mark to its destination (sliding departing marks off the
 * grid) rather than snapping the board. Covers every mark on the pre-shift
 * `board`:
 * - "classic": every mark steps one cell in `direction`; a mark stepped off the
 *   edge `departs`.
 * - "collapse": each line steps toward the leading edge by the run of marks
 *   matching the edge value (mirroring collapseLineTowardEnd); marks stepped past
 *   the edge `departs`.
 * Departing marks are sent a full board-length past the edge so they clear it.
 */
export function shiftPlan(
  board: Board,
  direction: Direction,
  mode: ShiftMode = DEFAULT_SHIFT_MODE,
): ShiftMotion[] {
  const size = INITIAL_SIZE;
  const [dr, dc] = DIRECTION_STEPS[direction];
  const coord = (index: number): CellCoord => ({
    row: Math.floor(index / size),
    col: index % size,
  });
  const motions: ShiftMotion[] = [];

  if (mode === "classic") {
    for (let i = 0; i < board.length; i++) {
      const player = board[i];
      if (player === null) continue;
      const from = coord(i);
      const to = { row: from.row + dr, col: from.col + dc };
      const departs =
        to.row < 0 || to.row >= size || to.col < 0 || to.col >= size;
      motions.push({ player, from, to, departs });
    }
    return motions;
  }

  const horizontal = direction === "left" || direction === "right";
  const towardEnd = direction === "right" || direction === "bottom";
  for (let li = 0; li < size; li++) {
    const indices: number[] = [];
    for (let j = 0; j < size; j++) {
      indices.push(horizontal ? li * size + j : j * size + li);
    }
    const order = towardEnd ? indices : indices.slice().reverse();
    const line = order.map((k) => board[k]);
    const n = line.length;
    // The line steps toward the edge by the run of cells matching the edge
    // value; a mark stepped past the edge (p + run >= n) is swept off.
    const edge = line[n - 1];
    let run = 0;
    while (run < n && line[n - 1 - run] === edge) run += 1;
    for (let p = 0; p < n; p++) {
      const player = line[p];
      if (player === null) continue;
      const from = coord(order[p]);
      const departs = p + run >= n;
      const steps = departs ? size : run;
      const to = { row: from.row + dr * steps, col: from.col + dc * steps };
      motions.push({ player, from, to, departs });
    }
  }
  return motions;
}

/**
 * Reconstruct a game's board after its first `count` actions. Players alternate
 * strictly (X takes the even-indexed actions, O the odd ones); each action
 * either places that player's mark or applies O's whole-grid shift. The board is
 * always 3×3, so the action list alone rebuilds any point in the game.
 */
export function boardAfterActions(
  actions: readonly GameAction[],
  count: number,
): Board {
  let board: Board = Array(INITIAL_SIZE * INITIAL_SIZE).fill(null);
  const upTo = Math.max(0, Math.min(count, actions.length));
  for (let i = 0; i < upTo; i++) {
    const action = actions[i];
    if (action.kind === "place") {
      board[action.index] = i % 2 === 0 ? "X" : "O";
    } else {
      board = shiftBoard(board, action.dir, action.mode ?? DEFAULT_SHIFT_MODE);
    }
  }
  return board;
}

/** Terminal scores dwarf depth so a real win is always chosen. */
const WIN_SCORE = 1_000_000;

// The board is always 3×3, so a full, exact minimax is always affordable - no
// depth limit or heuristic cutoff is needed.
function minimax(
  board: Board,
  current: Player,
  aiPlayer: Player,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const result = calculateWinner(board);
  if (result) {
    return result.winner === aiPlayer ? WIN_SCORE - depth : depth - WIN_SCORE;
  }
  if (isBoardFull(board)) return 0;

  const isMaximizing = current === aiPlayer;
  let best = isMaximizing ? -Infinity : Infinity;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) continue;
    board[i] = current;
    const score = minimax(
      board,
      otherPlayer(current),
      aiPlayer,
      depth + 1,
      alpha,
      beta,
    );
    board[i] = null;
    if (isMaximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break; // alpha-beta cutoff
  }
  return best;
}

/**
 * Best placement for `aiPlayer` together with its minimax score (the value of
 * the resulting position with the opponent to move, from `aiPlayer`'s view).
 * `index` is -1 and `score` is -Infinity when the board is full.
 */
function bestPlacement(
  board: Board,
  aiPlayer: Player,
): { index: number; score: number } {
  const work = board.slice();
  let bestScore = -Infinity;
  let bestMove = -1;
  for (let i = 0; i < work.length; i++) {
    if (work[i] !== null) continue;
    work[i] = aiPlayer;
    const score = minimax(
      work,
      otherPlayer(aiPlayer),
      aiPlayer,
      1,
      -Infinity,
      Infinity,
    );
    work[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }
  return { index: bestMove, score: bestScore };
}

/**
 * Count a player's immediate winning threats: lines that already hold two of
 * that player's marks and one empty cell, so the player could complete them on
 * their next placement.
 */
function immediateThreats(board: Board, player: Player): number {
  let count = 0;
  for (const [a, b, c] of WINNING_LINES) {
    const cells = [board[a], board[b], board[c]];
    const mine = cells.filter((cell) => cell === player).length;
    const empty = cells.filter((cell) => cell === null).length;
    if (mine === 2 && empty === 1) count += 1;
  }
  return count;
}

/**
 * Choose the AI's action for the current turn. `aiPlayer` is the seat the AI
 * holds (X or O); the result is always a placement for X, and for O may instead
 * be its once-per-game whole-grid shift when `canShift` is true. Returns null
 * only if the board is full.
 *
 * Placing and shifting both consume the whole turn, so they are weighed head to
 * head by the same lookahead (the value of the resulting position with the
 * opponent to move). The shift is chosen when it either strictly improves that
 * value - the only way it can be the outright best move, e.g. scattering an
 * opponent fork no placement could block - or, at no cost to the game-theoretic
 * outcome (an equal value), it is genuinely useful this turn: it builds an
 * immediate threat the best placement would not, or defuses more of the
 * opponent's threats. This keeps the one-time shift an active part of the AI's
 * play without ever trading away a forced win or draw.
 */
export function chooseAiAction(
  board: Board,
  aiPlayer: Player,
  canShift: boolean,
  shiftMode: ShiftMode = DEFAULT_SHIFT_MODE,
): GameAction | null {
  const me = aiPlayer;
  const opponent = otherPlayer(me);
  const { index: placeIndex, score: placeScore } = bestPlacement(board, me);
  if (placeIndex === -1) return null;

  let best: GameAction = { kind: "place", index: placeIndex };
  if (!canShift) return best;

  // Value of a position with the opponent to move next, from the AI's view. The
  // best placement's value is already known, so only shifts need a fresh look.
  const value = (b: Board) => minimax(b, opponent, me, 1, -Infinity, Infinity);

  // The board after the AI's best placement, used to compare how each option
  // shifts the immediate-threat balance.
  const placedBoard = board.slice();
  placedBoard[placeIndex] = me;
  const placeMyThreats = immediateThreats(placedBoard, me);
  const placeOppThreats = immediateThreats(placedBoard, opponent);

  // Evaluate (and later record) each shift under the active mode so the AI
  // weighs the same outcome the human would get.
  let bestShift: { dir: Direction; board: Board; score: number } | null = null;
  for (const dir of DIRECTIONS) {
    const shifted = shiftBoard(board, dir, shiftMode);
    const score = value(shifted);
    if (!bestShift || score > bestShift.score) {
      bestShift = { dir, board: shifted, score };
    }
  }
  if (!bestShift) return best;

  const tiedButUseful =
    bestShift.score === placeScore &&
    (immediateThreats(bestShift.board, me) > placeMyThreats ||
      immediateThreats(bestShift.board, opponent) < placeOppThreats);
  if (bestShift.score > placeScore || tiedButUseful) {
    best = { kind: "shift", dir: bestShift.dir, mode: shiftMode };
  }
  return best;
}
