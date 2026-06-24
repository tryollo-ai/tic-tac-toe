import type { Board } from "@/lib/gameLogic";
import styles from "./styles.module.scss";

interface MiniBoardProps {
  board: Board;
  rows: number;
  cols: number;
}

/** A small, read-only board preview used in lobby room cards. */
export default function MiniBoard({ board, rows, cols }: MiniBoardProps) {
  return (
    <div
      className={styles.mini}
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
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
}
