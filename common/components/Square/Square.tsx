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
  const classNames = [
    styles.square,
    value === "X" ? styles.x : "",
    value === "O" ? styles.o : "",
    isWinning ? styles.winning : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classNames}
      onClick={onClick}
      disabled={disabled || value !== null}
      aria-label={`Square ${index + 1}${value ? `, ${value}` : ", empty"}`}
    >
      {value}
    </button>
  );
};

export default Square;
