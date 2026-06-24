import { INITIAL_SIZE, type Board } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

interface MiniBoardProps {
  board: Board;
}

/** A small, read-only board preview used in lobby room cards. */
const MiniBoard = ({ board }: MiniBoardProps) => {
  return (
    <div
      className={styles.mini}
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${INITIAL_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${INITIAL_SIZE}, 1fr)`,
      }}
    >
      {board.map((value, index) => (
        <div
          key={index}
          className={[
            styles.cell,
            value === "X" ? styles.x : "",
            value === "O" ? styles.o : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {value}
        </div>
      ))}
    </div>
  );
};

export default MiniBoard;
