export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[];

export const WINNING_LINES: readonly [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export interface WinnerResult {
  winner: Player;
  line: [number, number, number];
}

/**
 * Returns the winning player and the line that won, or null if there is no
 * winner yet.
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
 * Reconstruct the board after the first `count` moves of a game. `moves` is the
 * list of played cell indices in turn order; X plays the even-numbered moves
 * (0, 2, …) and O the odd ones, mirroring how a real game always alternates.
 */
export function boardAfterMoves(moves: readonly number[], count: number): Board {
  const board: Board = Array(9).fill(null);
  const upTo = Math.max(0, Math.min(count, moves.length));
  for (let i = 0; i < upTo; i++) {
    board[moves[i]] = i % 2 === 0 ? "X" : "O";
  }
  return board;
}

/**
 * Minimax with depth weighting so the AI prefers faster wins and slower losses.
 * Returns a score from the perspective of `aiPlayer`.
 */
function minimax(
  board: Board,
  currentPlayer: Player,
  aiPlayer: Player,
  depth: number,
): number {
  const result = calculateWinner(board);
  if (result) {
    return result.winner === aiPlayer ? 10 - depth : depth - 10;
  }
  if (isBoardFull(board)) {
    return 0;
  }

  const isMaximizing = currentPlayer === aiPlayer;
  let best = isMaximizing ? -Infinity : Infinity;

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) continue;
    board[i] = currentPlayer;
    const score = minimax(
      board,
      otherPlayer(currentPlayer),
      aiPlayer,
      depth + 1,
    );
    board[i] = null;
    best = isMaximizing ? Math.max(best, score) : Math.min(best, score);
  }

  return best;
}

/**
 * Returns the index of the optimal move for `aiPlayer`, or -1 if the board is
 * full. The AI plays perfectly and is unbeatable.
 */
export function getBestMove(board: Board, aiPlayer: Player): number {
  let bestScore = -Infinity;
  let bestMove = -1;

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) continue;
    const next = board.slice();
    next[i] = aiPlayer;
    const score = minimax(next, otherPlayer(aiPlayer), aiPlayer, 1);
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }

  return bestMove;
}
