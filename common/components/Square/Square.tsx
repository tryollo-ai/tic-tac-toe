import classNames from "classnames";
import type { Cell } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

interface SquareProps {
  value: Cell;
  onClick: () => void;
  isWinning: boolean;
  disabled: boolean;
  index: number;
}

const Square = ({
  value,
  onClick,
  isWinning,
  disabled,
  index,
}: SquareProps) => {
  return (
    <button
      type="button"
      className={classNames(styles.square, {
        [styles.x]: value === "X",
        [styles.o]: value === "O",
        [styles.winning]: isWinning,
      })}
      onClick={onClick}
      disabled={disabled || value !== null}
      aria-label={`Square ${index + 1}${value ? `, ${value}` : ", empty"}`}
    >
      {value}
    </button>
  );
};

export default Square;
