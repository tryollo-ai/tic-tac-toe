import { INITIAL_SIZE } from "@/constants/game";
import { type Board as BoardState, type Direction } from "@/utils/gameLogic";
import Square from "@/common/components/Square";
import WinningLine from "@/common/components/WinningLine";
import styles from "./styles.module.scss";

type Props = {
  board: BoardState;
  winningLine: readonly number[] | null;
  onSquareClick: (index: number) => void;
  disabled: boolean;
  /**
   * Set for the brief moment after a whole-grid shift so every mark slides in
   * from the cell it came from; null/omitted renders the board with no motion.
   */
  shiftDirection?: Direction | null;
  /**
   * Index of the cell just marked, which plays a one-shot drop-in. Null/omitted
   * leaves every mark static.
   */
  placedIndex?: number | null;
};

const Board = (props: Props) => {
  return (
    <div
      className={styles.root}
      role="grid"
      aria-label="Tic-tac-toe board"
      style={{ gridTemplateColumns: `repeat(${INITIAL_SIZE}, 1fr)` }}
    >
      {props.board.map((value, index) => (
        <Square
          key={index}
          index={index}
          value={value}
          isWinning={props.winningLine?.includes(index) ?? false}
          onClick={() => props.onSquareClick(index)}
          disabled={props.disabled}
          shiftDirection={props.shiftDirection}
          justPlaced={props.placedIndex === index}
        />
      ))}
      {props.winningLine && <WinningLine line={props.winningLine} />}
    </div>
  );
};

export default Board;
