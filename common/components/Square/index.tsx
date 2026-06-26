import classNames from "classnames";
import type { Cell, Direction } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

type Props = {
  value: Cell;
  onClick: () => void;
  isWinning: boolean;
  disabled: boolean;
  index: number;
  /**
   * When set, the mark slides in from the neighbour the grid shifted away from,
   * so a whole-grid shift reads as the marks travelling one cell. Null/omitted
   * renders the mark in place with no motion.
   */
  shiftDirection?: Direction | null;
};

/** Slide-in animation class per shift direction; the mark enters from the source cell. */
const SHIFT_SLIDE_CLASS: Record<Direction, string> = {
  left: styles.slideLeft,
  right: styles.slideRight,
  top: styles.slideTop,
  bottom: styles.slideBottom,
};

const Square = (props: Props) => {
  return (
    <button
      type="button"
      className={classNames(styles.square, {
        [styles.x]: props.value === "X",
        [styles.o]: props.value === "O",
        [styles.winning]: props.isWinning,
      })}
      onClick={props.onClick}
      disabled={props.disabled || props.value !== null}
      aria-label={`Square ${props.index + 1}${props.value ? `, ${props.value}` : ", empty"}`}
    >
      {props.value !== null && (
        <span
          className={classNames(
            styles.mark,
            props.shiftDirection
              ? SHIFT_SLIDE_CLASS[props.shiftDirection]
              : undefined,
          )}
        >
          {props.value}
        </span>
      )}
    </button>
  );
};

export default Square;
