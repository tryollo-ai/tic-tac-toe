import { winningLineCoords } from "@/utils/winningLineGeometry";
import styles from "./styles.module.scss";

type Props = {
  /** The winning cell indices, ordered along the line. */
  line: readonly number[];
  /** Side length of the board the line sits on, for percentage geometry. */
  size: number;
};

const WinningLine = (props: Props) => {
  const { x1, y1, x2, y2 } = winningLineCoords(props.line, props.size);
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
