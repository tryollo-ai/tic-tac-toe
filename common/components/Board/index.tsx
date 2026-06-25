import { INITIAL_SIZE } from "@/constants/game";
import { type Board as BoardState } from "@/utils/gameLogic";
import Square from "@/common/components/Square";
import WinningLine from "@/common/components/WinningLine";
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
      className={styles.root}
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
      {winningLine && <WinningLine line={winningLine} />}
    </div>
  );
};

export default Board;
