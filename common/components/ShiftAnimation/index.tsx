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
  // Where the mark ends up after the shift fires: a destination column, or how
  // it leaves the board - "fall" (classic: pushed off the leading edge) or
  // "captured" (collapse: swept off as the line collapses against the edge).
  to: number | "fall" | "captured";
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
    caption: "O shifts the grid one cell right",
    marks: [
      { id: "x-tl", player: "X", row: 0, col: 0, to: 1 },
      { id: "o-tr", player: "O", row: 0, col: 2, to: "fall" },
      { id: "x-mid", player: "X", row: 1, col: 1, to: 2 },
      { id: "o-bl", player: "O", row: 2, col: 0, to: 1 },
      { id: "x-br", player: "X", row: 2, col: 2, to: "fall" },
    ],
  },
  // Collapse: each row collapses toward the leading (right) edge - the leading
  // run of matching cells is swept off and the first cell that differs settles
  // at the edge. Row 0 sweeps the two X at the edge and lands the trailing O;
  // row 1 slides a lone O across; row 2 sweeps a lone mark sitting on the edge.
  collapse: {
    caption: "O collapses the grid to the right",
    marks: [
      { id: "c-o-settle", player: "O", row: 0, col: 0, to: 2 },
      { id: "c-x-swept-a", player: "X", row: 0, col: 1, to: "captured" },
      { id: "c-x-swept-b", player: "X", row: 0, col: 2, to: "captured" },
      { id: "c-o-slide", player: "O", row: 1, col: 1, to: 2 },
      { id: "c-x-edge", player: "X", row: 2, col: 2, to: "captured" },
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
 * collapses toward the edge - the leading run of matching marks is swept off and
 * the first differing mark settles against the edge.
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
                  [styles.captured]: shifted && mark.to === "captured",
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
