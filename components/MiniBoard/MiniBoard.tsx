import type { Board } from "@/lib/gameLogic";
import styles from "./styles.module.scss";

interface MiniBoardProps {
  board: Board;
}

/** A small, read-only board preview used in lobby room cards. */
export default function MiniBoard({ board }: MiniBoardProps) {
  return (
    <div className={styles.mini} aria-hidden="true">
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
