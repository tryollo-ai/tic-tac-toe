import classNames from "classnames";
import type { Cell } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

type Props = {
  value: Cell;
  onClick: () => void;
  isWinning: boolean;
  disabled: boolean;
  index: number;
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
      {props.value}
    </button>
  );
};

export default Square;
