import type { CSSProperties } from "react";
import classNames from "classnames";
import { boardSize, calculateWinner, type Board } from "@/utils/gameLogic";
import WinningLine from "@/common/components/WinningLine";
import styles from "./styles.module.scss";

type Props = {
  board: Board;
  /** Win run length, if known, so the highlighted line matches the game's rule.
   *  Previews that don't know it fall back to the classic 3-in-a-row. */
  winLength?: number;
  /** Fixed cell size in px. When set, cells stay this size and the board grows
   *  with the board dimension (so the mark stays legible on a dense board);
   *  otherwise the board is a fixed width and cells shrink to fit. */
  cellSize?: number;
};

/** A small, read-only board preview used in lobby room cards. */
const MiniBoard = (props: Props) => {
  const size = boardSize(props.board);
  const winningLine =
    calculateWinner(props.board, props.winLength)?.line ?? null;

  // Default: fixed total width, cells share it (`1fr`). With `cellSize`: each
  // cell is that many px and the board grows to fit them, with the mark scaled
  // to match (the full board's `cell * 0.56`).
  const rootStyle: CSSProperties = props.cellSize
    ? {
        gridTemplateColumns: `repeat(${size}, ${props.cellSize}px)`,
        width: "max-content",
        fontSize: props.cellSize * 0.56,
      }
    : { gridTemplateColumns: `repeat(${size}, 1fr)` };

  return (
    <div className={styles.root} aria-hidden="true" style={rootStyle}>
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
      {winningLine && <WinningLine line={winningLine} size={size} />}
    </div>
  );
};

export default MiniBoard;
