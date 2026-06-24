"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCompletedGame, RoomError } from "@/lib/roomClient";
import {
  boardAfterActions,
  calculateWinner,
  type Player,
} from "@/lib/gameLogic";
import { modeLabel, type CompletedGameView } from "@/lib/roomTypes";
import Board from "@/components/Board/Board";
import Status, { type StatusTone, playerTone } from "@/components/Status/Status";
import styles from "./styles.module.scss";

interface ReplayProps {
  id: string;
}

/** Milliseconds between moves while auto-playing. */
const AUTOPLAY_MS = 800;

export default function Replay({ id }: ReplayProps) {
  const [game, setGame] = useState<CompletedGameView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Number of moves shown so far: 0 is the empty board, moves.length is final.
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Completed games are immutable, so fetch once instead of polling.
  useEffect(() => {
    const controller = new AbortController();
    fetchCompletedGame(id, controller.signal)
      .then(setGame)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof RoomError && err.code === "game-not-found") {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [id]);

  const total = game ? game.actions.length : 0;

  // Advance one move at a time while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => Math.min(s + 1, total)), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, step, total]);

  if (notFound) {
    return (
      <div className={styles.notFound}>
        <p className={styles.notFoundTitle}>Game no longer exists</p>
        <p className={styles.notFoundHint}>
          Completed games are kept temporarily and may have been cleared, or the
          server restarted.
        </p>
        <Link href="/" className={styles.backLink}>
          Back to lobby
        </Link>
      </div>
    );
  }

  if (!game) {
    return (
      <div className={styles.loading}>
        {loadError ? "Could not load the game." : "Loading game…"}
      </div>
    );
  }

  const board = boardAfterActions(game.actions, step);
  const result = calculateWinner(board);
  const atStart = step === 0;
  const atEnd = step === total;

  let statusMessage: string;
  let statusTone: StatusTone;
  if (result) {
    statusMessage = `${result.winner} wins!`;
    statusTone = playerTone(result.winner);
  } else if (atEnd) {
    statusMessage = "Draw";
    statusTone = "draw";
  } else {
    const next: Player = step % 2 === 0 ? "X" : "O";
    statusMessage = `${next} to move`;
    statusTone = playerTone(next);
  }

  const goTo = (next: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(next, total)));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Restart from the beginning if we're already at the end.
    if (step >= total) setStep(0);
    setPlaying(true);
  };

  return (
    <div className={styles.replay}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back}>
          ← Lobby
        </Link>
        <h1 className={styles.title}>{game.name}</h1>
        <span className={styles.modeTag}>{modeLabel(game.mode)}</span>
      </header>

      <p className={styles.replayTag}>Replay · read-only</p>

      <Status message={statusMessage} tone={statusTone} />

      <Board
        board={board}
        winningLine={result ? result.line : null}
        onSquareClick={() => {}}
        disabled
      />

      <div className={styles.progress}>
        Turn {step} / {total}
      </div>

      <div className={styles.controls} role="group" aria-label="Replay controls">
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => goTo(0)}
          disabled={atStart}
          aria-label="Jump to start"
        >
          ⏮
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => goTo(step - 1)}
          disabled={atStart}
          aria-label="Previous move"
        >
          ◀
        </button>
        <button
          type="button"
          className={styles.playButton}
          onClick={togglePlay}
          disabled={total === 0}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : atEnd ? "Replay" : "Play"}
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => goTo(step + 1)}
          disabled={atEnd}
          aria-label="Next move"
        >
          ▶
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => goTo(total)}
          disabled={atEnd}
          aria-label="Jump to end"
        >
          ⏭
        </button>
      </div>
    </div>
  );
}
