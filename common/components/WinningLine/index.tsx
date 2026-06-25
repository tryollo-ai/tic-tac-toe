import { winningLineCoords } from "@/utils/winningLineGeometry";
import styles from "./styles.module.scss";

interface WinningLineProps {
  /** The three winning cell indices, ordered along the line. */
  line: readonly number[];
}

const WinningLine = ({ line }: WinningLineProps) => {
  const { x1, y1, x2, y2 } = winningLineCoords(line);
  return (
    <svg
      className={styles.overlay}
      aria-hidden="true"
    >
      <line
        className={styles.line}
        x1={`${x1}%`}
        y1={`${y1}%`}
        x2={`${x2}%`}
        y2={`${y2}%`}
      />
    </svg>
  );
};

export default WinningLine;
