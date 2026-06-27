"use client";

import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { IoArrowForward } from "react-icons/io5";
import { useQuery } from "@tanstack/react-query";
import { fetchCompletedGame, RoomError } from "@/utils/roomClient";
import {
  boardAfterActions,
  calculateWinner,
  type Direction,
} from "@/utils/gameLogic";
import { actionSentence } from "@/utils/historyLabels";
import { type CompletedGameView } from "@/lib/roomTypes";
import Board from "@/common/components/Board";
import RoomHeader from "@/common/components/RoomHeader";
import RoomNotFound, { RoomLoading } from "@/common/components/RoomMessage";
import Status, { spectatorStatus } from "@/common/components/Status";
import styles from "./styles.module.scss";
import squareStyles from "@/common/components/Square/styles.module.scss";

type Props = {
  id: string;
};

/** Milliseconds between moves while auto-playing. */
const AUTOPLAY_MS = 800;

/** Drop-in duration for a freshly marked cell; owned by Square's stylesheet. */
const PLACE_ANIMATION_MS = Number(squareStyles.placeMs) || 320;

/**
 * How long the shift cue (sliding marks + the directional arrow) stays on the
 * board. Owned by this component's stylesheet so the arrow's fade and the clear
 * timer can't drift apart; it outlasts Square's mark slide so the arrow lingers
 * a beat after the grid settles.
 */
const SHIFT_ANIMATION_MS = Number(styles.shiftArrowMs) || 620;

/** Rotation class that points the (right-facing) arrow icon in `dir`. */
const ARROW_DIR_CLASS: Record<Direction, string> = {
  top: styles.arrowTop,
  bottom: styles.arrowBottom,
  left: styles.arrowLeft,
  right: styles.arrowRight,
};

const Replay = (props: Props) => {
  // Number of moves shown so far: 0 is the empty board, moves.length is final.
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The cell to drop-in for the move just shown, or null at rest.
  const [placedIndex, setPlacedIndex] = useState<number | null>(null);
  // The direction of the shift cue currently playing, or null at rest.
  const [shiftDirection, setShiftDirection] = useState<Direction | null>(null);

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

  // Animate the move revealed by a single forward advance (autoplay or "Next"):
  // a placement drops its mark in, a shift slides the grid and flashes a
  // directional arrow. Any other change - a jump, a step back, or the first
  // render - shows the position with no motion. The ref tracks the prior step so
  // only a +1 advance, where exactly one new action is in view, triggers a cue.
  const prevStepRef = useRef(step);
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (step !== prev + 1) {
      setPlacedIndex(null);
      setShiftDirection(null);
      return;
    }
    const action = game?.actions[step - 1];
    if (!action) return;
    if (action.kind === "place") {
      setShiftDirection(null);
      setPlacedIndex(action.index);
    } else {
      setPlacedIndex(null);
      setShiftDirection(action.dir);
    }
  }, [step, game]);

  // Clear each cue once it has played so the board returns to its static render.
  useEffect(() => {
    if (placedIndex === null) return;
    const timer = setTimeout(() => setPlacedIndex(null), PLACE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [placedIndex]);

  useEffect(() => {
    if (!shiftDirection) return;
    const timer = setTimeout(() => setShiftDirection(null), SHIFT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [shiftDirection]);

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
  // The action just shown, narrated below the board (e.g. "O shifted the grid
  // down") so a shift turn reads as a deliberate move rather than a skipped one.
  const lastAction = step > 0 ? game.actions[step - 1] : null;

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

      <div className={styles.boardWrap}>
        <Board
          board={board}
          winningLine={result ? result.line : null}
          onSquareClick={() => {}}
          disabled
          shiftDirection={shiftDirection}
          placedIndex={placedIndex}
        />

        {shiftDirection && (
          <div
            className={classNames(
              styles.shiftArrow,
              ARROW_DIR_CLASS[shiftDirection],
            )}
            aria-hidden="true"
          >
            <IoArrowForward className={styles.shiftArrowIcon} />
          </div>
        )}
      </div>

      <div className={styles.progress}>
        Turn {step} / {total}
      </div>

      <p
        className={classNames(styles.moveCaption, {
          [styles.moveCaptionShift]: lastAction?.kind === "shift",
        })}
        aria-live="polite"
      >
        {lastAction ? actionSentence(lastAction, step - 1) : "Start of game"}
      </p>

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
