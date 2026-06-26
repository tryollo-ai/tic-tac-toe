import classNames from "classnames";
import styles from "./styles.module.scss";

export type StatusTone = "x" | "o" | "draw" | "neutral";

/** Maps a player to their status tone. */
export const playerTone = (player: "X" | "O"): StatusTone =>
  player === "X" ? "x" : "o";

/** A status line: the message to show and the tone to colour it with. */
export type StatusInfo = { message: string; tone: StatusTone };

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
    </div>
  );
};

export default Status;
