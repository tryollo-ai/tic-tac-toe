import { INITIAL_SIZE, type Board as BoardState } from "@/utils/gameLogic";
import Square from "@/common/components/Square/Square";
import styles from "./styles.module.scss";

interface BoardProps {
  board: BoardState;
  winningLine: readonly number[] | null;
  onSquareClick: (index: number) => void;
  disabled: boolean;
}

const Board = ({
  board,
  winningLine,
  onSquareClick,
  disabled,
}: BoardProps) => {
  return (
    <div
      className={styles.board}
      role="grid"
      aria-label="Tic-tac-toe board"
      style={{ gridTemplateColumns: `repeat(${INITIAL_SIZE}, 1fr)` }}
    >
      {board.map((value, index) => (
        <Square
          key={index}
          index={index}
          value={value}
          isWinning={winningLine?.includes(index) ?? false}
          onClick={() => onSquareClick(index)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};

export default Board;
