"use client";

import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { animated, to, useTransition } from "@react-spring/web";
import { INITIAL_SIZE } from "@/constants/game";
import { SHIFT_SLIDE_MS } from "@/constants/animation";
import {
  shiftPlan,
  type Board as BoardState,
  type Direction,
  type Player,
  type ShiftMode,
} from "@/utils/gameLogic";
import Square from "@/common/components/Square";
import WinningLine from "@/common/components/WinningLine";
import styles from "./styles.module.scss";

/** Board grid gap in px; keep in sync with `gap` in styles.module.scss. */
const GAP = 10;
const SIZE = INITIAL_SIZE;

/**
 * A one-shot cue describing how the board reached its current `board` prop, so
 * the marks layer can animate the change instead of snapping to it. Pass a fresh
 * object only when an animation should play; pass null at rest. A board change
 * with no fresh cue snaps into place (resets, replay jumps, opponent moves).
 */
export type BoardTransition =
  | { kind: "place"; index: number }
  | { kind: "shift"; direction: Direction; mode: ShiftMode; from: BoardState };

/** One animated mark with a stable identity that survives across a shift. */
type Sprite = { id: number; player: Player; row: number; col: number };

const STEP: Record<Direction, [number, number]> = {
  top: [-1, 0],
  bottom: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/** How far (in cells) a swept mark slides past its cell as it leaves - just
 *  enough to clear the edge while it fades and shrinks, not across the board. */
const DEPART_CELLS = 1.15;

/** Marks for `board`, reusing the prior sprite at each cell so ids stay stable
 *  (a cell whose mark is unchanged keeps its id and therefore does not animate). */
function snapSprites(
  prev: Sprite[],
  board: BoardState,
  nextId: () => number,
): Sprite[] {
  const byCell = new Map(prev.map((s) => [s.row * SIZE + s.col, s]));
  const out: Sprite[] = [];
  for (let i = 0; i < board.length; i++) {
    const player = board[i];
    if (player === null) continue;
    const existing = byCell.get(i);
    out.push(
      existing && existing.player === player
        ? existing
        : { id: nextId(), player, row: Math.floor(i / SIZE), col: i % SIZE },
    );
  }
  return out;
}

/** Sprites after a shift: survivors keep their id and move to their settled
 *  cell; swept marks are dropped here and animate off the grid via `leave`. */
function shiftSprites(
  prev: Sprite[],
  from: BoardState,
  direction: Direction,
  mode: ShiftMode,
  nextId: () => number,
): Sprite[] {
  const byCell = new Map(prev.map((s) => [s.row * SIZE + s.col, s]));
  const survivors: Sprite[] = [];
  for (const motion of shiftPlan(from, direction, mode)) {
    if (motion.departs) continue;
    const existing = byCell.get(motion.from.row * SIZE + motion.from.col);
    survivors.push(
      existing
        ? { ...existing, row: motion.to.row, col: motion.to.col }
        : {
            id: nextId(),
            player: motion.player,
            row: motion.to.row,
            col: motion.to.col,
          },
    );
  }
  return survivors;
}

type Props = {
  board: BoardState;
  winningLine: readonly number[] | null;
  onSquareClick: (index: number) => void;
  disabled: boolean;
  /** How the board reached its current state, for animation; null at rest. */
  transition?: BoardTransition | null;
};

const Board = (props: Props) => {
  const { board, transition } = props;

  // Live cell size in px so the marks layer can position by pixel offset, which
  // is what react-spring animates. Measured from the overlay, which is inset to
  // the cells, and kept current on resize.
  const layerRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = () => setCell((el.clientWidth - (SIZE - 1) * GAP) / SIZE);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Reconcile the sprite list during render (a derived-state pattern): a fresh
  // transition animates the change, any other board change snaps. Guarded by the
  // transition identity and the board contents so it runs once per real change.
  const spritesRef = useRef<Sprite[]>([]);
  const idRef = useRef(0);
  const nextId = () => (idRef.current += 1);
  const lastTransitionRef = useRef<BoardTransition | null>(null);
  const lastBoardKeyRef = useRef<string | null>(null);
  const immediateRef = useRef(true); // first mount snaps; transitions set false
  const departDirRef = useRef<Direction>("left");

  const boardKey = board.map((c) => c ?? ".").join("");
  if (transition && transition !== lastTransitionRef.current) {
    lastTransitionRef.current = transition;
    lastBoardKeyRef.current = boardKey;
    immediateRef.current = false;
    spritesRef.current =
      transition.kind === "shift"
        ? ((departDirRef.current = transition.direction),
          shiftSprites(
            spritesRef.current,
            transition.from,
            transition.direction,
            transition.mode,
            nextId,
          ))
        : snapSprites(spritesRef.current, board, nextId); // place: new cell enters
  } else if (boardKey !== lastBoardKeyRef.current) {
    lastBoardKeyRef.current = boardKey;
    immediateRef.current = true;
    spritesRef.current = snapSprites(spritesRef.current, board, nextId);
  }
  const sprites = spritesRef.current;

  const point = (row: number, col: number) => ({
    x: col * (cell + GAP),
    y: row * (cell + GAP),
  });

  const transitions = useTransition(sprites, {
    keys: (s) => s.id,
    from: (s) => ({ ...point(s.row, s.col), opacity: 0, scale: 0.4 }),
    enter: (s) => ({ ...point(s.row, s.col), opacity: 1, scale: 1 }),
    update: (s) => ({ ...point(s.row, s.col), opacity: 1, scale: 1 }),
    leave: (s) => {
      // A swept mark slides just past the leading edge while it fades and
      // shrinks, so it reads as falling off the grid.
      const [dr, dc] = STEP[departDirRef.current];
      return {
        ...point(s.row + dr * DEPART_CELLS, s.col + dc * DEPART_CELLS),
        opacity: 0,
        scale: 0.2,
      };
    },
    immediate: immediateRef.current || reducedMotion,
    config: (_s, _i, phase) =>
      phase === "enter"
        ? { tension: 320, friction: 20 }
        : { duration: SHIFT_SLIDE_MS },
  });

  return (
    <div
      className={styles.root}
      role="grid"
      aria-label="Tic-tac-toe board"
      style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
    >
      {board.map((value, index) => (
        <Square
          key={index}
          index={index}
          value={value}
          isWinning={props.winningLine?.includes(index) ?? false}
          onClick={() => props.onSquareClick(index)}
          disabled={props.disabled}
        />
      ))}

      <div ref={layerRef} className={styles.marks} aria-hidden="true">
        {cell > 0 &&
          transitions((style, sprite) => (
            <animated.div
              className={classNames(
                styles.mark,
                sprite.player === "X" ? styles.x : styles.o,
              )}
              style={{
                width: cell,
                height: cell,
                fontSize: cell * 0.56,
                opacity: style.opacity,
                transform: to(
                  [style.x, style.y, style.scale],
                  (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`,
                ),
              }}
            >
              {sprite.player}
            </animated.div>
          ))}
      </div>

      {props.winningLine && <WinningLine line={props.winningLine} />}
    </div>
  );
};

export default Board;
