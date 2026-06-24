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

/** The board is a fixed square of this side length. */
export const INITIAL_SIZE = 3;
/** Marks in a line needed to win. */
export const WIN_LENGTH = 3;

/**
 * One turn's action. Players alternate strictly - X takes the even-indexed
 * actions, O the odd ones - and on a turn a player either places a mark or, as
 * O's once-per-game option, shifts the whole grid (which uses up the turn
 * instead of placing). The ordered action list is a game's single source of
 * truth, so replaying any prefix of it rebuilds the board exactly.
 */
export type GameAction =
  | { kind: "place"; index: number }
  | { kind: "shift"; dir: Direction };

/** A reconstructed board together with its dimensions, used by replay. */
export interface ReplayState {
  board: Board;
  rows: number;
  cols: number;
}

export interface WinnerResult {
  winner: Player;
  line: [number, number, number];
}

/**
 * The winning triples for a given board size are stable, so memoize them by
 * dimension instead of recomputing on every win check.
 */
const lineCache = new Map<string, readonly [number, number, number][]>();

function computeWinningLines(
  rows: number,
  cols: number,
): readonly [number, number, number][] {
  const lines: [number, number, number][] = [];
  const at = (r: number, c: number) => r * cols + c;
  const k = WIN_LENGTH;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + k - 1 < cols) {
        lines.push([at(r, c), at(r, c + 1), at(r, c + 2)]);
      }
      if (r + k - 1 < rows) {
        lines.push([at(r, c), at(r + 1, c), at(r + 2, c)]);
      }
      if (r + k - 1 < rows && c + k - 1 < cols) {
        lines.push([at(r, c), at(r + 1, c + 1), at(r + 2, c + 2)]);
      }
      if (r + k - 1 < rows && c - (k - 1) >= 0) {
        lines.push([at(r, c), at(r + 1, c - 1), at(r + 2, c - 2)]);
      }
    }
  }
  return lines;
}

/** All winning triples (flat indices) for a rows×cols board. */
export function winningLines(
  rows: number,
  cols: number,
): readonly [number, number, number][] {
  const key = `${rows}x${cols}`;
  let lines = lineCache.get(key);
  if (!lines) {
    lines = computeWinningLines(rows, cols);
    lineCache.set(key, lines);
  }
  return lines;
}

/**
 * Returns the winning player and the line that won, or null if there is no
 * winner yet. A win is always three in a row, on a board of any size.
 */
export function calculateWinner(
  board: Board,
  rows: number,
  cols: number,
): WinnerResult | null {
  for (const line of winningLines(rows, cols)) {
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
export function isGameOver(board: Board, rows: number, cols: number): boolean {
  return calculateWinner(board, rows, cols) !== null || isBoardFull(board);
}

export function otherPlayer(player: Player): Player {
  return player === "X" ? "O" : "X";
}

/**
 * Slide the whole grid one cell in `direction`. Any marks pushed off the leading
 * edge are removed and the trailing edge comes in empty; the dimensions are
 * unchanged. Returns a fresh board; the input is not mutated. This is O's
 * once-per-game shift action.
 */
export function shiftBoard(
  board: Board,
  rows: number,
  cols: number,
  direction: Direction,
): Board {
  const next: Board = Array(rows * cols).fill(null);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const value = board[r * cols + c];
      if (value === null) continue;
      let nr = r;
      let nc = c;
      if (direction === "top") nr -= 1;
      else if (direction === "bottom") nr += 1;
      else if (direction === "left") nc -= 1;
      else nc += 1;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue; // rides off
      next[nr * cols + nc] = value;
    }
  }
  return next;
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
): ReplayState {
  let board: Board = Array(INITIAL_SIZE * INITIAL_SIZE).fill(null);
  const rows = INITIAL_SIZE;
  const cols = INITIAL_SIZE;
  const upTo = Math.max(0, Math.min(count, actions.length));
  for (let i = 0; i < upTo; i++) {
    const action = actions[i];
    if (action.kind === "place") {
      board[action.index] = i % 2 === 0 ? "X" : "O";
    } else {
      board = shiftBoard(board, rows, cols, action.dir);
    }
  }
  return { board, rows, cols };
}

function countEmpty(board: Board): number {
  let n = 0;
  for (const cell of board) if (cell === null) n++;
  return n;
}

// Full, exact minimax stays affordable up to a 3×3 board; beyond that the
// search is depth-limited and falls back to a heuristic at the cutoff.
const FULL_SEARCH_MAX_EMPTY = INITIAL_SIZE * INITIAL_SIZE;
const DEPTH_LIMIT = 6;
/** Terminal scores dwarf any heuristic value so a real win is always chosen. */
const WIN_SCORE = 1_000_000;

/** Static evaluation from `aiPlayer`'s perspective for depth-limited search. */
function heuristic(
  board: Board,
  rows: number,
  cols: number,
  aiPlayer: Player,
): number {
  const opp = otherPlayer(aiPlayer);
  let score = 0;
  for (const [a, b, c] of winningLines(rows, cols)) {
    let ai = 0;
    let op = 0;
    for (const i of [a, b, c]) {
      if (board[i] === aiPlayer) ai++;
      else if (board[i] === opp) op++;
    }
    if (ai > 0 && op > 0) continue; // contested line, no value to either side
    if (ai > 0) score += ai === 2 ? 50 : 1;
    else if (op > 0) score -= op === 2 ? 50 : 1;
  }
  return score;
}

function minimax(
  board: Board,
  rows: number,
  cols: number,
  current: Player,
  aiPlayer: Player,
  depth: number,
  maxDepth: number,
  alpha: number,
  beta: number,
): number {
  const result = calculateWinner(board, rows, cols);
  if (result) {
    return result.winner === aiPlayer ? WIN_SCORE - depth : depth - WIN_SCORE;
  }
  if (isBoardFull(board)) return 0;
  if (depth >= maxDepth) return heuristic(board, rows, cols, aiPlayer);

  const isMaximizing = current === aiPlayer;
  let best = isMaximizing ? -Infinity : Infinity;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) continue;
    board[i] = current;
    const score = minimax(
      board,
      rows,
      cols,
      otherPlayer(current),
      aiPlayer,
      depth + 1,
      maxDepth,
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

function depthFor(board: Board): number {
  return countEmpty(board) <= FULL_SEARCH_MAX_EMPTY ? Infinity : DEPTH_LIMIT;
}

/**
 * Returns the index of the best move for `aiPlayer`, or -1 if the board is
 * full. Exact (unbeatable) on a 3×3 board; depth-limited on larger boards.
 */
export function getBestMove(
  board: Board,
  rows: number,
  cols: number,
  aiPlayer: Player,
): number {
  const work = board.slice();
  const maxDepth = depthFor(work);
  let bestScore = -Infinity;
  let bestMove = -1;
  for (let i = 0; i < work.length; i++) {
    if (work[i] !== null) continue;
    work[i] = aiPlayer;
    const score = minimax(
      work,
      rows,
      cols,
      otherPlayer(aiPlayer),
      aiPlayer,
      1,
      maxDepth,
      -Infinity,
      Infinity,
    );
    work[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }
  return bestMove;
}

/**
 * Choose O's action for the current turn when O is the AI: either its best
 * placement, or - when `canShift` - its once-per-game whole-grid shift if that
 * yields a strictly better position. Because shifting uses up the turn, the two
 * options are weighed head to head by the same lookahead (the value of the
 * resulting position with X to move). Returns null only if the board is full.
 */
export function chooseAiAction(
  board: Board,
  rows: number,
  cols: number,
  canShift: boolean,
): GameAction | null {
  const me: Player = "O";
  const placeIndex = getBestMove(board, rows, cols, me);
  if (placeIndex === -1) return null;

  // Value of a position with X (the opponent) to move next, from O's view.
  const value = (b: Board) =>
    minimax(b, rows, cols, "X", me, 1, depthFor(b), -Infinity, Infinity);

  const placed = board.slice();
  placed[placeIndex] = me;
  let best: GameAction = { kind: "place", index: placeIndex };
  let bestScore = value(placed);

  if (canShift) {
    for (const dir of DIRECTIONS) {
      const score = value(shiftBoard(board, rows, cols, dir));
      if (score > bestScore) {
        bestScore = score;
        best = { kind: "shift", dir };
      }
    }
  }
  return best;
}
