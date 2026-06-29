"use client";

import { useEffect, useState } from "react";
import classNames from "classnames";
import { IoArrowForward } from "react-icons/io5";
import { INITIAL_SIZE } from "@/constants/game";
import { DEFAULT_SHIFT_MODE, type ShiftMode } from "@/utils/gameLogic";
import styles from "./styles.module.scss";

type SceneMark = {
  id: string;
  player: "X" | "O";
  row: number;
  col: number;
  // Where the mark ends up after the shift fires: a destination column, or
  // "fall" - a mark pushed off the leading edge (classic edge marks, or a
  // collapse's leading run that matches the edge value).
  to: number | "fall";
};

type Scene = {
  marks: readonly SceneMark[];
  caption: string;
};

// A small, fixed scene that illustrates O's grid shift to the right. Both scenes
// are hand-authored rather than driven through `shiftBoard` so the picture stays
// legible - each always shows the behaviour that defines its mode.
const SCENES: Record<ShiftMode, Scene> = {
  // Classic: every mark slides exactly one cell over; marks pushed off the
  // leading (right) edge fall away.
  classic: {
    caption: "Trick (classic): O slides the grid one cell",
    marks: [
      { id: "x-tl", player: "X", row: 0, col: 0, to: 1 },
      { id: "o-tr", player: "O", row: 0, col: 2, to: "fall" },
      { id: "x-mid", player: "X", row: 1, col: 1, to: 2 },
      { id: "o-bl", player: "O", row: 2, col: 0, to: 1 },
      { id: "x-br", player: "X", row: 2, col: 2, to: "fall" },
    ],
  },
  // Collapse: each row shifts toward the leading (right) edge, shedding the
  // leading run of marks that match the edge value and packing the rest against
  // the wall. This is a real board - `O X X / X O . / O . X` collapsed right
  // becomes `. . O / . X O / . O .`, chosen so every behaviour shows at once:
  // row 0's two edge X sweep off and the O behind them packs to the wall, row
  // 1's X survives while its O packs in, and row 2's lone edge X sweeps off
  // while its O slides one cell in behind it.
  collapse: {
    caption: "Trick (collapse): O slides consecutive marks off the edge",
    marks: [
      { id: "c-o0", player: "O", row: 0, col: 0, to: 2 },
      { id: "c-x0a", player: "X", row: 0, col: 1, to: "fall" },
      { id: "c-x0b", player: "X", row: 0, col: 2, to: "fall" },
      { id: "c-x1", player: "X", row: 1, col: 0, to: 1 },
      { id: "c-o1", player: "O", row: 1, col: 1, to: 2 },
      { id: "c-o2", player: "O", row: 2, col: 0, to: 1 },
      { id: "c-x2", player: "X", row: 2, col: 2, to: "fall" },
    ],
  },
};

// One loop: the arrow sweeps, the grid shifts, then the result is held before
// the scene resets. Kept colocated with the component as UI-only timings.
const ARROW_MS = 1500;
const SHIFT_MS = 750;
const HOLD_MS = 1100;

/**
 * Looping, decorative illustration of player O's grid shift, shown at the bottom
 * of the "How to play" dialog. A directional arrow fades in and drifts, then the
 * marks resolve the shift for the active {@link ShiftMode}: in "classic" each
 * mark slides one cell (edge marks fall away), while in "collapse" each line
 * shifts toward the edge until the edge value changes, shedding the leading run
 * of marks that match the edge while the next mark settles against it.
 * Honours `prefers-reduced-motion` by holding the starting board still.
 */
const ShiftAnimation = ({ mode = DEFAULT_SHIFT_MODE }: { mode?: ShiftMode }) => {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [shifted, setShifted] = useState(false);
  // Bumped each loop and used as a remount key so the scene resets to its start
  // state without playing every transition in reverse.
  const [cycle, setCycle] = useState(0);

  const scene = SCENES[mode] ?? SCENES[DEFAULT_SHIFT_MODE];

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const toShift = setTimeout(() => setShifted(true), ARROW_MS);
    const toReset = setTimeout(() => {
      setShifted(false);
      setCycle((c) => c + 1);
    }, ARROW_MS + SHIFT_MS + HOLD_MS);
    return () => {
      clearTimeout(toShift);
      clearTimeout(toReset);
    };
  }, [cycle, reducedMotion]);

  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.stage}>
        <div className={styles.slots}>
          {Array.from({ length: INITIAL_SIZE * INITIAL_SIZE }, (_, i) => (
            <div key={i} className={styles.slot} />
          ))}
        </div>

        <div key={`marks-${cycle}`} className={styles.marks}>
          {scene.marks.map((mark) => {
            const cells = typeof mark.to === "number" ? mark.to - mark.col : 0;
            return (
              <div
                key={mark.id}
                className={classNames(styles.mark, {
                  [styles.x]: mark.player === "X",
                  [styles.o]: mark.player === "O",
                  [styles.shifted]: shifted && typeof mark.to === "number",
                  [styles.fallOff]: shifted && mark.to === "fall",
                })}
                style={
                  {
                    gridColumn: mark.col + 1,
                    gridRow: mark.row + 1,
                    "--shift-cells": cells,
                  } as React.CSSProperties
                }
              >
                {mark.player}
              </div>
            );
          })}
        </div>

        {!reducedMotion && (
          <div key={`arrow-${cycle}`} className={styles.arrow}>
            <IoArrowForward className={styles.arrowIcon} />
          </div>
        )}
      </div>
      <span className={styles.caption}>{scene.caption}</span>
    </div>
  );
};

export default ShiftAnimation;
