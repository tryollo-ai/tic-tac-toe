import classNames from "classnames";
import type { Cell } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

type Props = {
  value: Cell;
  onClick: () => void;
  isWinning: boolean;
  disabled: boolean;
  index: number;
};

/**
 * One interactive board cell: the clickable surface, its disabled/winning state,
 * and the accessible label. The mark glyph itself is rendered and animated by
 * the Board's react-spring marks layer (see BoardMarks), which sits above the
 * grid, so a cell can stay put while a mark slides across or off the board.
 */
const Square = (props: Props) => {
  return (
    <button
      type="button"
      className={classNames(styles.square, {
        [styles.winning]: props.isWinning,
      })}
      onClick={props.onClick}
      disabled={props.disabled || props.value !== null}
      aria-label={`Square ${props.index + 1}${props.value ? `, ${props.value}` : ", empty"}`}
    />
  );
};

export default Square;
