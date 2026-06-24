import classNames from "classnames";
import { INITIAL_SIZE } from "@/constants/game";
import { type Board } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

interface MiniBoardProps {
  board: Board;
}

/** A small, read-only board preview used in lobby room cards. */
const MiniBoard = ({ board }: MiniBoardProps) => {
  return (
    <div
      className={styles.root}
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${INITIAL_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${INITIAL_SIZE}, 1fr)`,
      }}
    >
      {board.map((value, index) => (
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
    </div>
  );
};

export default MiniBoard;
