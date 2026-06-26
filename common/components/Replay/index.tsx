"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCompletedGame, RoomError } from "@/utils/roomClient";
import { boardAfterActions, calculateWinner } from "@/utils/gameLogic";
import { type CompletedGameView } from "@/lib/roomTypes";
import Board from "@/common/components/Board";
import RoomHeader from "@/common/components/RoomHeader";
import RoomNotFound, { RoomLoading } from "@/common/components/RoomMessage";
import Status, { spectatorStatus } from "@/common/components/Status";
import styles from "./styles.module.scss";

type Props = {
  id: string;
};

/** Milliseconds between moves while auto-playing. */
const AUTOPLAY_MS = 800;

const Replay = (props: Props) => {
  // Number of moves shown so far: 0 is the empty board, moves.length is final.
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Completed games are immutable, so fetch once and never poll or refetch.
  const { data: game, error } = useQuery<CompletedGameView>({
    queryKey: ["completedGame", props.id],
    queryFn: ({ signal }) => fetchCompletedGame(props.id, signal),
    staleTime: Infinity,
  });

  const notFound =
    error instanceof RoomError && error.code === "game-not-found";
  const loadError = Boolean(error) && !notFound;

  const total = game ? game.actions.length : 0;

  // Advance one move at a time while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setStep((s) => Math.min(s + 1, total)),
      AUTOPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, step, total]);

  if (notFound) {
    return (
      <RoomNotFound
        title="Game no longer exists"
        hint="Completed games are kept temporarily and may have been cleared, or the server restarted."
      />
    );
  }

  if (!game) {
    return (
      <RoomLoading>
        {loadError ? "Could not load the game." : "Loading game…"}
      </RoomLoading>
    );
  }

  const board = boardAfterActions(game.actions, step);
  const result = calculateWinner(board);
  const atStart = step === 0;
  const atEnd = step === total;

  const { message: statusMessage, tone: statusTone } = spectatorStatus(
    result ? result.winner : null,
    step % 2 === 0 ? "X" : "O",
    atEnd,
  );

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
    <div className={styles.root}>
      <RoomHeader name={game.name} mode={game.mode} />

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

      <div
        className={styles.controls}
        role="group"
        aria-label="Replay controls"
      >
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
};

export default Replay;
