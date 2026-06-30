import classNames from "classnames";
import styles from "./styles.module.scss";

export type StatusTone = "x" | "o" | "draw" | "neutral";

/** Maps a player to their status tone. */
export const playerTone = (player: "X" | "O"): StatusTone =>
  player === "X" ? "x" : "o";

/**
 * A status line: the message to show and the tone to colour it with. `pending`
 * marks a waiting state (e.g. waiting for an opponent) that should render an
 * animated trailing ellipsis to read as live rather than stalled.
 */
export type StatusInfo = { message: string; tone: StatusTone; pending?: boolean };

/**
 * The neutral, observer's-eye status of a position: who won, a draw, or whose
 * move it is. `winner` is the winning player (or null), `toMove` is the player
 * to move next, and `isOver` distinguishes a draw from an in-progress game.
 * Shared by the live room and the replay viewer.
 */
export const spectatorStatus = (
  winner: "X" | "O" | null,
  toMove: "X" | "O",
  isOver: boolean,
): StatusInfo => {
  if (winner) return { message: `${winner} wins!`, tone: playerTone(winner) };
  if (isOver) return { message: "Draw", tone: "draw" };
  return { message: `${toMove} to move`, tone: playerTone(toMove) };
};

type Props = {
  message: string;
  tone: StatusTone;
  /** Append an animated, reveal-one-to-three-dots ellipsis (waiting states). */
  pending?: boolean;
};

const Status = (props: Props) => {
  const toneClass: Record<StatusTone, string> = {
    x: styles.x,
    o: styles.o,
    draw: styles.draw,
    neutral: "",
  };

  return (
    <div className={classNames(styles.root, toneClass[props.tone])} role="status" aria-live="polite">
      {props.message}
      {props.pending && (
        // Decorative: the message already conveys the wait to assistive tech, so
        // the animated dots are hidden from it to avoid a chattering live region.
        <span className={styles.dots} aria-hidden="true">
          <span className={styles.dot}>.</span>
          <span className={styles.dot}>.</span>
          <span className={styles.dot}>.</span>
        </span>
      )}
    </div>
  );
};

export default Status;
