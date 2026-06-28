import { DEFAULT_WIN_LENGTH, INITIAL_SIZE } from "@/constants/game";

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
  /** The winning cells as flat indices, ordered along the line. Its length is
   *  the game's win run length (3 on a classic board, more on larger ones). */
  line: number[];
}

/** Side length of a (square) board, derived from its cell count. */
export function boardSize(board: Board): number {
  return Math.round(Math.sqrt(board.length));
}

/**
 * Every winning line on a `size`×`size` board: each straight run of exactly
 * `winLength` consecutive cells, horizontally, vertically, or along either
 * diagonal, as flat indices ordered along the line. On the classic 3×3 board
 * with a run of 3 this is the familiar eight lines (three rows, three columns,
 * two diagonals); larger boards or shorter runs yield every place such a run can
 * sit. Memoized per (size, winLength) since the set is fixed and read on every
 * win check and AI evaluation.
 */
const lineCache = new Map<string, number[][]>();
export function winningLines(size: number, winLength: number): number[][] {
  const key = `${size}:${winLength}`;
  const cached = lineCache.get(key);
  if (cached) return cached;

  const lines: number[][] = [];
  // Step vectors for the four orientations a run can take; their reverses would
  // only retrace the same cells, so four suffice.
  const steps: [number, number][] = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // ↘ diagonal
    [1, -1], // ↙ diagonal
  ];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const [dr, dc] of steps) {
        const endR = r + dr * (winLength - 1);
        const endC = c + dc * (winLength - 1);
        if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;
        const line: number[] = [];
        for (let k = 0; k < winLength; k++) {
          line.push((r + dr * k) * size + (c + dc * k));
        }
        lines.push(line);
      }
    }
  }
  lineCache.set(key, lines);
  return lines;
}

/**
 * Returns the winning player and the line that won, or null if there is no
 * winner yet. A win is `winLength` of the same mark in a consecutive straight
 * line (row, column, or diagonal); the board size is read from `board`.
 */
export function calculateWinner(
  board: Board,
  winLength: number = DEFAULT_WIN_LENGTH,
): WinnerResult | null {
  const size = boardSize(board);
  for (const line of winningLines(size, winLength)) {
    const first = board[line[0]];
    if (first && line.every((i) => board[i] === first)) {
      return { winner: first as Player, line };
    }
  }
  return null;
}

/** True when every cell is filled. */
export function isBoardFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

/** True when the game is over (someone won or the board is full). */
export function isGameOver(
  board: Board,
  winLength: number = DEFAULT_WIN_LENGTH,
): boolean {
  return calculateWinner(board, winLength) !== null || isBoardFull(board);
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
  const size = boardSize(board);
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
  const size = boardSize(board);
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
 * either places that player's mark or applies O's whole-grid shift. A game's
 * board side length is fixed for its whole life, so `size` (the side the game
 * was played at, defaulting to the classic 3×3) plus the action list rebuilds
 * any point in the game.
 */
export function boardAfterActions(
  actions: readonly GameAction[],
  count: number,
  size: number = INITIAL_SIZE,
): Board {
  let board: Board = Array(size * size).fill(null);
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

/** Side length at or below which the board is solved exactly (the classic 3×3,
 *  small enough that a full minimax is always affordable). Larger boards use the
 *  bounded heuristic search below so the server can never hang. */
const EXACT_SIZE = 3;

/** Plies the heuristic search looks ahead on boards too large to solve exactly:
 *  the AI's move and the opponent's reply, enough to take an immediate win and
 *  block an immediate one. */
const HEURISTIC_DEPTH = 2;

/**
 * Exact minimax for a small board (≤ {@link EXACT_SIZE}): explores every empty
 * cell to the end of the game, with alpha-beta pruning. A win needs `winLength`
 * in a row; the score rewards the AI's wins (sooner is better) and penalizes the
 * opponent's.
 */
function minimax(
  board: Board,
  current: Player,
  aiPlayer: Player,
  depth: number,
  alpha: number,
  beta: number,
  winLength: number,
): number {
  const result = calculateWinner(board, winLength);
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
      winLength,
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

/** How much a line counts toward a player's score when it holds `count` of their
 *  marks and none of the opponent's: steeply rising so a near-complete line far
 *  outweighs scattered marks (one mark short of a win is worth most). */
function lineWeight(count: number): number {
  return Math.pow(10, count - 1);
}

/**
 * Static evaluation for boards too large to solve exactly: score every winning
 * line by how near each side is to completing it. A line holding both players'
 * marks is dead and scores nothing; otherwise a line with `k` of one player's
 * marks (and no opponent mark) is worth {@link lineWeight}. The result is the
 * AI's total minus the opponent's, with a settled win dominating everything.
 */
function evaluateBoard(
  board: Board,
  aiPlayer: Player,
  winLength: number,
): number {
  const result = calculateWinner(board, winLength);
  if (result) return result.winner === aiPlayer ? WIN_SCORE : -WIN_SCORE;

  const opponent = otherPlayer(aiPlayer);
  let score = 0;
  for (const line of winningLines(boardSize(board), winLength)) {
    let mine = 0;
    let theirs = 0;
    for (const i of line) {
      if (board[i] === aiPlayer) mine += 1;
      else if (board[i] === opponent) theirs += 1;
    }
    if (mine > 0 && theirs > 0) continue; // contested - completable by neither
    if (mine > 0) score += lineWeight(mine);
    else if (theirs > 0) score -= lineWeight(theirs);
  }
  return score;
}

/**
 * Empty cells worth considering on a large board: those within one step
 * (including diagonally) of an existing mark, where all meaningful play
 * happens - this keeps the branching factor small on a mostly-empty big board.
 * An empty board has no neighbours, so it opens in the middle.
 */
function candidateCells(board: Board): number[] {
  const size = boardSize(board);
  if (board.every((cell) => cell === null)) {
    return [Math.floor(board.length / 2)];
  }
  const cells = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) continue;
    const r = Math.floor(i / size);
    const c = i % size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const j = nr * size + nc;
        if (board[j] === null) cells.add(j);
      }
    }
  }
  return [...cells];
}

/**
 * Depth-limited negamax over {@link candidateCells} with alpha-beta pruning,
 * falling back to {@link evaluateBoard} at the depth cap. Used for boards larger
 * than {@link EXACT_SIZE}, where a full search is intractable; it is bounded so
 * the AI always responds promptly, at the cost of not playing perfectly.
 */
function heuristicSearch(
  board: Board,
  current: Player,
  aiPlayer: Player,
  depth: number,
  alpha: number,
  beta: number,
  winLength: number,
): number {
  // A settled win dominates, and a sooner one (found with more depth to spare)
  // outranks a later one - so the AI takes an immediate win over a slower forced
  // one, mirroring the exact minimax's depth preference.
  const winner = calculateWinner(board, winLength);
  if (winner) {
    return winner.winner === aiPlayer ? WIN_SCORE + depth : -(WIN_SCORE + depth);
  }
  if (depth === 0 || isBoardFull(board)) {
    return evaluateBoard(board, aiPlayer, winLength);
  }
  const isMaximizing = current === aiPlayer;
  let best = isMaximizing ? -Infinity : Infinity;
  for (const i of candidateCells(board)) {
    board[i] = current;
    const score = heuristicSearch(
      board,
      otherPlayer(current),
      aiPlayer,
      depth - 1,
      alpha,
      beta,
      winLength,
    );
    board[i] = null;
    if (isMaximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * Best placement for `aiPlayer` together with its score (the value of the
 * resulting position with the opponent to move, from `aiPlayer`'s view). Solves
 * the board exactly when it is small enough, otherwise uses the bounded
 * heuristic search. `index` is -1 when the board is full.
 */
function bestPlacement(
  board: Board,
  aiPlayer: Player,
  winLength: number,
): { index: number; score: number } {
  const work = board.slice();
  const exact = boardSize(board) <= EXACT_SIZE;
  const candidates = exact
    ? work.map((_, i) => i).filter((i) => work[i] === null)
    : candidateCells(work);
  let bestScore = -Infinity;
  let bestMove = -1;
  for (const i of candidates) {
    work[i] = aiPlayer;
    const score = exact
      ? minimax(work, otherPlayer(aiPlayer), aiPlayer, 1, -Infinity, Infinity, winLength)
      : heuristicSearch(
          work,
          otherPlayer(aiPlayer),
          aiPlayer,
          HEURISTIC_DEPTH,
          -Infinity,
          Infinity,
          winLength,
        );
    work[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }
  return { index: bestMove, score: bestScore };
}

/** Value of a position with the opponent to move, from the AI's view, using the
 *  same engine (exact or heuristic) as {@link bestPlacement} - so a shift is
 *  weighed against a placement on the same footing. */
function positionValue(
  board: Board,
  aiPlayer: Player,
  winLength: number,
): number {
  return boardSize(board) <= EXACT_SIZE
    ? minimax(board, otherPlayer(aiPlayer), aiPlayer, 1, -Infinity, Infinity, winLength)
    : heuristicSearch(
        board,
        otherPlayer(aiPlayer),
        aiPlayer,
        HEURISTIC_DEPTH,
        -Infinity,
        Infinity,
        winLength,
      );
}

/**
 * Count a player's immediate winning threats: lines one mark short of a win -
 * holding `winLength - 1` of that player's marks and a single empty cell - so
 * the player could complete them on their next placement.
 */
function immediateThreats(
  board: Board,
  player: Player,
  winLength: number,
): number {
  let count = 0;
  for (const line of winningLines(boardSize(board), winLength)) {
    let mine = 0;
    let empty = 0;
    for (const i of line) {
      if (board[i] === player) mine += 1;
      else if (board[i] === null) empty += 1;
    }
    if (mine === winLength - 1 && empty === 1) count += 1;
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
  winLength: number = DEFAULT_WIN_LENGTH,
): GameAction | null {
  const me = aiPlayer;
  const opponent = otherPlayer(me);
  const { index: placeIndex, score: placeScore } = bestPlacement(
    board,
    me,
    winLength,
  );
  if (placeIndex === -1) return null;

  let best: GameAction = { kind: "place", index: placeIndex };
  if (!canShift) return best;

  // The board after the AI's best placement, used to compare how each option
  // shifts the immediate-threat balance.
  const placedBoard = board.slice();
  placedBoard[placeIndex] = me;
  const placeMyThreats = immediateThreats(placedBoard, me, winLength);
  const placeOppThreats = immediateThreats(placedBoard, opponent, winLength);

  // Evaluate (and later record) each shift under the active mode so the AI
  // weighs the same outcome the human would get.
  let bestShift: { dir: Direction; board: Board; score: number } | null = null;
  for (const dir of DIRECTIONS) {
    const shifted = shiftBoard(board, dir, shiftMode);
    const score = positionValue(shifted, me, winLength);
    if (!bestShift || score > bestShift.score) {
      bestShift = { dir, board: shifted, score };
    }
  }
  if (!bestShift) return best;

  const tiedButUseful =
    bestShift.score === placeScore &&
    (immediateThreats(bestShift.board, me, winLength) > placeMyThreats ||
      immediateThreats(bestShift.board, opponent, winLength) < placeOppThreats);
  if (bestShift.score > placeScore || tiedButUseful) {
    best = { kind: "shift", dir: bestShift.dir, mode: shiftMode };
  }
  return best;
}
