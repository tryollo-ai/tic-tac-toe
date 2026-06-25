import classNames from "classnames";
import { INITIAL_SIZE } from "@/constants/game";
import { calculateWinner, type Board } from "@/utils/gameLogic";
import WinningLine from "@/common/components/WinningLine";
import styles from "./styles.module.scss";

type Props = {
  board: Board;
};

/** A small, read-only board preview used in lobby room cards. */
const MiniBoard = (props: Props) => {
  const winningLine = calculateWinner(props.board)?.line ?? null;

  return (
    <div
      className={styles.root}
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${INITIAL_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${INITIAL_SIZE}, 1fr)`,
      }}
    >
      {props.board.map((value, index) => (
        <div
          key={index}
          className={classNames(styles.cell, {
            [styles.x]: value === "X",
            [styles.o]: value === "O",
          })}
        >
          {value}
        </div>
      ))}
      {winningLine && <WinningLine line={winningLine} />}
    </div>
  );
};

export default MiniBoard;
