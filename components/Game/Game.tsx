"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  calculateWinner,
  getBestMove,
  isBoardFull,
  type Board as BoardState,
} from "@/lib/gameLogic";
import Board from "@/components/Board/Board";
import { type Scores } from "@/components/Scoreboard/Scoreboard";
import OverflowMenu from "@/components/OverflowMenu/OverflowMenu";
import Status, { type StatusTone, playerTone } from "@/components/Status/Status";
import styles from "./styles.module.scss";

export type GameMode = "two-player" | "ai";

const EMPTY_BOARD: BoardState = Array(9).fill(null);
const AI_PLAYER = "O";
const AI_MOVE_DELAY_MS = 450;

const INITIAL_SCORES: Scores = { X: 0, O: 0, draws: 0 };

export default function Game() {
  const [mode, setMode] = useState<GameMode>("two-player");
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [xIsNext, setXIsNext] = useState(true);
  const [scores, setScores] = useState<Scores>(INITIAL_SCORES);

  // Ensures each finished round is counted exactly once.
  const scoredRef = useRef(false);

  const result = calculateWinner(board, 3, 3);
  const boardFull = isBoardFull(board);
  const gameOver = result !== null || boardFull;
  const currentPlayer = xIsNext ? "X" : "O";
  const aiTurn = mode === "ai" && currentPlayer === AI_PLAYER;

  const makeMove = useCallback(
    (index: number) => {
      setBoard((prev) => {
        if (prev[index] !== null || calculateWinner(prev, 3, 3)) {
          return prev;
        }
        const next = prev.slice();
        next[index] = prev.filter((c) => c !== null).length % 2 === 0 ? "X" : "O";
        return next;
      });
      setXIsNext((prev) => !prev);
    },
    [],
  );

  const startNewGame = useCallback(() => {
    scoredRef.current = false;
    setBoard(EMPTY_BOARD);
    setXIsNext(true);
  }, []);

  const handleModeChange = useCallback(
    (nextMode: GameMode) => {
      if (nextMode === mode) return;
      setMode(nextMode);
      startNewGame();
    },
    [mode, startNewGame],
  );

  const handleResetScores = useCallback(() => {
    setScores(INITIAL_SCORES);
    startNewGame();
  }, [startNewGame]);

  // Record the result of a finished round exactly once.
  useEffect(() => {
    if (scoredRef.current) return;
    if (result) {
      scoredRef.current = true;
      setScores((prev) => ({ ...prev, [result.winner]: prev[result.winner] + 1 }));
    } else if (boardFull) {
      scoredRef.current = true;
      setScores((prev) => ({ ...prev, draws: prev.draws + 1 }));
    }
  }, [result, boardFull]);

  // Drive the AI's move when it is the computer's turn.
  useEffect(() => {
    if (!aiTurn || gameOver) return;
    const timer = setTimeout(() => {
      const move = getBestMove(board, 3, 3, AI_PLAYER);
      if (move !== -1) makeMove(move);
    }, AI_MOVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [aiTurn, gameOver, board, makeMove]);

  const xLabel = mode === "ai" ? "You (X)" : "Player X";
  const oLabel = mode === "ai" ? "AI (O)" : "Player O";

  let statusMessage: string;
  let statusTone: StatusTone;
  if (result) {
    const winnerLabel = result.winner === "X" ? xLabel : oLabel;
    statusMessage = `${winnerLabel} wins!`;
    statusTone = playerTone(result.winner);
  } else if (boardFull) {
    statusMessage = "It's a draw!";
    statusTone = "draw";
  } else if (aiTurn) {
    statusMessage = "AI is thinking...";
    statusTone = "o";
  } else {
    statusMessage =
      mode === "ai" ? "Your turn (X)" : `${currentPlayer} to move`;
    statusTone = playerTone(currentPlayer);
  }

  return (
    <div className={styles.game}>
      <header className={styles.topBar}>
        <h1 className={styles.title}>Tic-Tac-Toe</h1>
        <OverflowMenu
          mode={mode}
          onModeChange={handleModeChange}
          scores={scores}
          xLabel={xLabel}
          oLabel={oLabel}
          onResetScores={handleResetScores}
        />
      </header>
      <Status message={statusMessage} tone={statusTone} />
      <Board
        board={board}
        cols={3}
        winningLine={result?.line ?? null}
        onSquareClick={makeMove}
        disabled={gameOver || aiTurn}
      />
      <button type="button" className={styles.newGame} onClick={startNewGame}>
        New Game
      </button>
    </div>
  );
}
