"use client";

import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { animated, to, useSpring, useTransition } from "@react-spring/web";
import { INITIAL_SIZE } from "@/constants/game";
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

/** One animated mark with a stable identity that survives across a shift.
 *  `leans` is whether this mark sways during the current shift - false for a mark
 *  that doesn't move (e.g. a collapse row already against the edge), so it stays
 *  perfectly still instead of leaning in place. */
type Sprite = {
  id: number;
  player: Player;
  row: number;
  col: number;
  leans: boolean;
};

const STEP: Record<Direction, [number, number]> = {
  top: [-1, 0],
  bottom: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/** How far (in cells) a swept mark slides past its cell as it leaves - just
 *  enough to clear the edge while it fades and shrinks, not across the board. */
const DEPART_CELLS = 1.15;

// Pop-in for a freshly placed mark (not part of the shift sway, so not tunable).
const ENTER_SPRING = { tension: 320, friction: 20 };

/** A react-spring tension/friction config; `clamp` stops it dead at the target
 *  with no overshoot. */
export type SpringConfig = { tension: number; friction: number; clamp?: boolean };

/**
 * The tunable timings of the grid-shift animation, overridable per <Board> via
 * the `animation` prop (the dev shift-debug panel drives these live). As the
 * grid shifts, every mark slides to its new cell (`slideSpring`) and leans into
 * its travel - a tilt going sideways, a squish going up/down - via a shared
 * board-level "lean" spring that pulses 0 -> 1 -> 0: it springs out with
 * `leanSpring`, holds for `leanReleaseDelayMs`, then springs back with
 * `departSpring` (which also drives a swept mark's fade/shrink off-board).
 * `leanTiltDeg`/`leanSquash` are the peak lean a full pulse reaches.
 */
export type BoardAnimationConfig = {
  slideSpring: SpringConfig;
  leanSpring: SpringConfig;
  departSpring: SpringConfig;
  leanReleaseDelayMs: number;
  leanTiltDeg: number;
  leanSquash: number;
};

export const DEFAULT_BOARD_ANIMATION: BoardAnimationConfig = {
  slideSpring: { tension: 260, friction: 26, clamp: true },
  leanSpring: { tension: 700, friction: 26, clamp: true },
  departSpring: { tension: 300, friction: 22, clamp: true },
  leanReleaseDelayMs: 160,
  leanTiltDeg: 8,
  leanSquash: 0.18,
};

/** Peak lean (tilt degrees / vertical squash) for a sweep in `direction`, scaled
 *  live by the shared lean spring. Horizontal sweeps tilt - left clockwise, right
 *  counter-clockwise; vertical sweeps squish instead, since a z-rotation reads as
 *  nothing for straight up/down travel. */
function leanFor(
  direction: Direction,
  anim: BoardAnimationConfig,
): { rotate: number; squash: number } {
  if (direction === "left") return { rotate: anim.leanTiltDeg, squash: 0 };
  if (direction === "right") return { rotate: -anim.leanTiltDeg, squash: 0 };
  return { rotate: 0, squash: anim.leanSquash };
}

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
    // A snap isn't a shift, so nothing is "moving"; but a mark that later gets
    // swept off in a shift departs from one of these, and departing marks do
    // lean - so default `leans` true and let shiftSprites mark the stationary
    // survivors false. (Harmless at rest: the lean spring sits at 0.)
    out.push(
      existing && existing.player === player
        ? { ...existing, leans: true }
        : {
            id: nextId(),
            player,
            row: Math.floor(i / SIZE),
            col: i % SIZE,
            leans: true,
          },
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
    // A survivor that lands on its own cell didn't move - it must not lean.
    const leans =
      motion.from.row !== motion.to.row || motion.from.col !== motion.to.col;
    const existing = byCell.get(motion.from.row * SIZE + motion.from.col);
    survivors.push(
      existing
        ? { ...existing, row: motion.to.row, col: motion.to.col, leans }
        : {
            id: nextId(),
            player: motion.player,
            row: motion.to.row,
            col: motion.to.col,
            leans,
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
  /** Override the shift-animation timings (dev shift-debug panel); defaults to
   *  {@link DEFAULT_BOARD_ANIMATION}. */
  animation?: BoardAnimationConfig;
};

const Board = (props: Props) => {
  const { board, transition } = props;
  const anim = props.animation ?? DEFAULT_BOARD_ANIMATION;

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

  // One board-level "lean" spring shared by every mark: it pulses 0 -> 1 -> 0
  // once per shift (see the effect below) and each mark's transform scales the
  // direction's peak tilt/squash by it. Lifting the lean here - rather than
  // driving it per sprite through useTransition's `update`, which re-runs every
  // render and would replay the sway on unrelated re-renders - lets survivors
  // and departing marks sway together off one source of truth.
  const [leanStyle, leanApi] = useSpring(() => ({ lean: 0 }));
  useEffect(() => {
    if (!transition || transition.kind !== "shift" || reducedMotion) return;
    // Spring into the lean as the grid starts moving, hold, then - nearing the
    // settle - spring it back to neutral. The unawaited lean-out lets the
    // delayed release overlap the tail of the slide rather than waiting for it.
    leanApi.start({
      to: async (next) => {
        void next({ lean: 1, config: anim.leanSpring });
        await next({
          lean: 0,
          delay: anim.leanReleaseDelayMs,
          config: anim.departSpring,
        });
      },
    });
  }, [transition, reducedMotion, leanApi, anim]);

  const transitions = useTransition(sprites, {
    keys: (s) => s.id,
    from: (s) => ({ ...point(s.row, s.col), opacity: 0, scale: 0.4 }),
    enter: (s) => ({ ...point(s.row, s.col), opacity: 1, scale: 1 }),
    update: (s) => ({ ...point(s.row, s.col), opacity: 1, scale: 1 }),
    leave: (s) => {
      // Only a shift sweeps a mark off the grid; every other removal (reset,
      // replay jump, reduced motion) snaps - the same `immediate` cases the
      // enter/update springs honor. The async leave below drives its own
      // springs, so the transition-wide `immediate` flag doesn't reach it; we
      // branch on it here instead, or a reset would slide every mark away. The
      // sway itself rides the shared lean spring above; here the mark just
      // slides off and, nearing its off-board resting spot, fades and shrinks.
      const snap = immediateRef.current || reducedMotion;
      const [dr, dc] = STEP[departDirRef.current];
      // Slide the mark to just past the LEADING edge of the board, not a fixed
      // hop from its own cell. Classic only ever sweeps edge marks, but collapse
      // can sweep a mark from deep in the line, which must travel the full
      // distance to clear the edge - a fixed DEPART_CELLS would strand it
      // mid-board. The edge is row/col 0 going up/left, SIZE-1 going down/right.
      const offRow =
        dr !== 0 ? (dr > 0 ? SIZE - 1 : 0) + dr * DEPART_CELLS : s.row;
      const offCol =
        dc !== 0 ? (dc > 0 ? SIZE - 1 : 0) + dc * DEPART_CELLS : s.col;
      return async (next: (props: object) => Promise<void>) => {
        if (snap) {
          await next({ opacity: 0, immediate: true });
          return;
        }
        void next({
          ...point(offRow, offCol),
          config: anim.slideSpring,
        });
        await next({
          opacity: 0,
          scale: 0.2,
          delay: anim.leanReleaseDelayMs,
          config: anim.departSpring,
        });
      };
    },
    immediate: immediateRef.current || reducedMotion,
    config: (_s, _i, phase) =>
      phase === "enter" ? ENTER_SPRING : anim.slideSpring,
  });

  // Peak tilt/squish for the in-flight shift's direction; the shared lean spring
  // scales between 0 (upright) and these values. Harmless at rest - lean is 0,
  // so the direction left over from the last shift contributes nothing.
  const leanPeak = leanFor(departDirRef.current, anim);

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
                  [style.x, style.y, style.scale, leanStyle.lean],
                  (x, y, s, l) => {
                    // The shared lean spring (l: 0..1) scales the direction's
                    // peak sway - but only for marks that actually move this
                    // shift, so a stationary mark stays perfectly still. scaleY
                    // alone carries the squash, so a vertical sweep just squishes
                    // the mark; scaleX stays at the scale.
                    const lean = sprite.leans ? l : 0;
                    const r = leanPeak.rotate * lean;
                    const sy = s * (1 - leanPeak.squash * lean);
                    return `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s}, ${sy})`;
                  },
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
