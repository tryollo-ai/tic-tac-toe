"use client";

import { useEffect, useState } from "react";
import classNames from "classnames";
import { IoArrowForward } from "react-icons/io5";
import { useQuery } from "@tanstack/react-query";
import { fetchCompletedGame, RoomError } from "@/utils/roomClient";
import {
  boardAfterActions,
  calculateWinner,
  DEFAULT_SHIFT_MODE,
  type Direction,
} from "@/utils/gameLogic";
import { actionSentence } from "@/utils/historyLabels";
import { type CompletedGameView } from "@/lib/roomTypes";
import { usePlayerId } from "@/lib/usePlayerId";
import { useStepCue } from "@/lib/useStepCue";
import Board, { type BoardTransition } from "@/common/components/Board";
import RoomHeader from "@/common/components/RoomHeader";
import RoomNotFound, { RoomLoading } from "@/common/components/RoomMessage";
import Status, { spectatorStatus } from "@/common/components/Status";
import styles from "./styles.module.scss";

type Props = {
  id: string;
};

/** Milliseconds between moves while auto-playing. */
const AUTOPLAY_MS = 800;

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
  // The directional arrow shown while a shift cue plays, faded out on a timer.
  const [arrowDir, setArrowDir] = useState<Direction | null>(null);

  const playerId = usePlayerId();

  // Completed games are immutable, so fetch once and never poll or refetch.
  const { data: game, error } = useQuery<CompletedGameView>({
    queryKey: ["completedGame", props.id, playerId],
    queryFn: ({ signal }) => fetchCompletedGame(props.id, playerId as string, signal),
    staleTime: Infinity,
    enabled: !!playerId,
  });

  const notFound =
    error instanceof RoomError &&
    (error.code === "game-not-found" || error.code === "forbidden");
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

  // Derive the move's animation cue DURING render so the board and its cue reach
  // <Board> in the same render. Setting it in an effect (as this once did)
  // arrived a render late: the board advanced to the new step with no cue, so
  // <Board> snapped the placed mark in (no drop-in) and snapped the shift, then
  // the cue fired with nothing left to animate. Only a single +1 advance (autoplay
  // or "Next") animates; a jump, a step back, or the first render shows the
  // position with no motion. useStepCue keeps this strict-mode-safe and holds the
  // cue's identity stable so each advance animates exactly once.
  const transition = useStepCue<BoardTransition>(
    step,
    (current, prev) => {
      const actions = game?.actions;
      if (prev === null || current !== prev + 1 || !actions) return null;
      const action = actions[current - 1];
      if (!action) return null;
      return action.kind === "place"
        ? { kind: "place", index: action.index }
        : {
            kind: "shift",
            direction: action.dir,
            mode: action.mode ?? DEFAULT_SHIFT_MODE,
            from: boardAfterActions(actions, current - 1, game?.size),
          };
    },
    step,
  );

  // Flash the directional arrow while a shift cue plays, then fade it out; the
  // board motion itself is driven by `transition` above.
  useEffect(() => {
    if (transition?.kind !== "shift") {
      setArrowDir(null);
      return;
    }
    setArrowDir(transition.direction);
    const timer = setTimeout(() => setArrowDir(null), SHIFT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [transition]);

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

  const board = boardAfterActions(game.actions, step, game.size);
  const result = calculateWinner(board, game.winLength);
  const atStart = step === 0;
  const atEnd = step === total;
  // The action just shown, narrated below the board (e.g. "O tricked the grid
  // down") so a trick turn reads as a deliberate move rather than a skipped one.
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
      <RoomHeader
        name={game.name}
        mode={game.mode}
        size={game.size}
        winLength={game.winLength}
      />

      <p className={styles.replayTag}>Replay · read-only</p>

      <Status message={statusMessage} tone={statusTone} />

      <div className={styles.boardWrap}>
        <Board
          board={board}
          winningLine={result ? result.line : null}
          onSquareClick={() => {}}
          disabled
          transition={transition}
        />

        {arrowDir && (
          <div
            className={classNames(
              styles.shiftArrow,
              ARROW_DIR_CLASS[arrowDir],
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
        {lastAction
          ? actionSentence(lastAction, step - 1, game.size)
          : "Start of game"}
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
