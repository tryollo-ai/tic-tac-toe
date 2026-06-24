export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[];

/** Directions a player can grow the board with their one-time extend action. */
export type Direction = "top" | "bottom" | "left" | "right";
export const DIRECTIONS: readonly Direction[] = [
  "top",
  "bottom",
  "left",
  "right",
];

/** A board always starts as a square of this side length. */
export const INITIAL_SIZE = 3;
/** Marks in a line needed to win, on a board of any size. */
export const WIN_LENGTH = 3;

/**
 * A board extension applied mid-game. `at` is the number of moves that had been
 * played when it happened, which is what lets a replay slot it back in order.
 */
export interface ExtendEvent {
  at: number;
  dir: Direction;
}

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
 * Grow the board by one row or column in the given direction, preserving the
 * relative position of every existing mark. Returns a fresh board and its new
 * dimensions; the input is not mutated.
 */
export function extendBoard(
  board: Board,
  rows: number,
  cols: number,
  direction: Direction,
): { board: Board; rows: number; cols: number } {
  if (direction === "top") {
    return { board: [...Array(cols).fill(null), ...board], rows: rows + 1, cols };
  }
  if (direction === "bottom") {
    return { board: [...board, ...Array(cols).fill(null)], rows: rows + 1, cols };
  }
  // "left" / "right": insert one cell into each existing row.
  const next: Board = [];
  for (let r = 0; r < rows; r++) {
    const row = board.slice(r * cols, r * cols + cols);
    if (direction === "left") next.push(null, ...row);
    else next.push(...row, null);
  }
  return { board: next, rows, cols: cols + 1 };
}

/**
 * Reconstruct a game's board after its first `count` moves, replaying the
 * board extensions that happened along the way so the result has the correct
 * size and mark positions at that point. `moves` is the list of played cell
 * indices in turn order (X plays the even-numbered moves, O the odd ones); each
 * recorded index is relative to the board as it existed when that move was
 * played. `extensions` lists each extension's direction and the number of moves
 * that had been played when it was applied, so they slot back in at the same
 * spot. With no extensions this matches a plain 3×3 reconstruction.
 */
export function boardAfterMoves(
  moves: readonly number[],
  count: number,
  extensions: readonly ExtendEvent[] = [],
): ReplayState {
  let board: Board = Array(INITIAL_SIZE * INITIAL_SIZE).fill(null);
  let rows = INITIAL_SIZE;
  let cols = INITIAL_SIZE;
  const applyExtendsAfter = (movesPlayed: number) => {
    for (const e of extensions) {
      if (e.at === movesPlayed) {
        const ext = extendBoard(board, rows, cols, e.dir);
        board = ext.board;
        rows = ext.rows;
        cols = ext.cols;
      }
    }
  };
  const upTo = Math.max(0, Math.min(count, moves.length));
  applyExtendsAfter(0);
  for (let i = 0; i < upTo; i++) {
    board[moves[i]] = i % 2 === 0 ? "X" : "O";
    applyExtendsAfter(i + 1);
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
/** Shallower lookahead used when weighing the (optional) AI extend action. */
const EXTEND_EVAL_DEPTH = 4;
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
 * Decide whether `aiPlayer` should spend its one-time extend action now, and in
 * which direction. Called right after the AI has moved (so it is the opponent's
 * turn). Returns the best direction only if it strictly improves the AI's
 * shallow-lookahead value, otherwise null so the AI saves the action for later.
 */
export function chooseAiExtend(
  board: Board,
  rows: number,
  cols: number,
  aiPlayer: Player,
): Direction | null {
  const value = (b: Board, r: number, c: number) =>
    minimax(
      b.slice(),
      r,
      c,
      otherPlayer(aiPlayer),
      aiPlayer,
      0,
      EXTEND_EVAL_DEPTH,
      -Infinity,
      Infinity,
    );

  let bestScore = value(board, rows, cols);
  let bestDir: Direction | null = null;
  for (const dir of DIRECTIONS) {
    const ext = extendBoard(board, rows, cols, dir);
    const score = value(ext.board, ext.rows, ext.cols);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }
  return bestDir;
}
