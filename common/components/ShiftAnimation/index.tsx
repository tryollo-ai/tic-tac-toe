"use client";

import { useEffect, useState } from "react";
import classNames from "classnames";
import { IoArrowForward } from "react-icons/io5";
import { INITIAL_SIZE } from "@/constants/game";
import styles from "./styles.module.scss";

type Mark = {
  id: string;
  player: "X" | "O";
  row: number;
  col: number;
};

// A small, fixed scene that illustrates O's grid shift to the right: every mark
// slides one cell over and the marks pushed off the leading (right) edge fall
// away. Kept as a static example rather than driven through `shiftBoard` so the
// picture stays legible - it always shows both a surviving mark and marks that
// fall off.
const MARKS: readonly Mark[] = [
  { id: "x-tl", player: "X", row: 0, col: 0 },
  { id: "o-tr", player: "O", row: 0, col: 2 },
  { id: "x-mid", player: "X", row: 1, col: 1 },
  { id: "o-bl", player: "O", row: 2, col: 0 },
  { id: "x-br", player: "X", row: 2, col: 2 },
];

// One loop: the arrow sweeps, the grid shifts, then the result is held before
// the scene resets. Kept colocated with the component as UI-only timings.
const ARROW_MS = 1500;
const SHIFT_MS = 750;
const HOLD_MS = 1100;

/**
 * Looping, decorative illustration of player O's grid shift, shown at the bottom
 * of the "How to play" dialog. A directional arrow fades in and drifts, then the
 * marks slide one cell and the ones pushed off the edge fall away. Honours
 * `prefers-reduced-motion` by holding the starting board still.
 */
const ShiftAnimation = () => {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [shifted, setShifted] = useState(false);
  // Bumped each loop and used as a remount key so the scene resets to its start
  // state without playing every transition in reverse.
  const [cycle, setCycle] = useState(0);

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
          {MARKS.map((mark) => {
            const fallsOff = mark.col + 1 >= INITIAL_SIZE;
            return (
              <div
                key={mark.id}
                className={classNames(styles.mark, {
                  [styles.x]: mark.player === "X",
                  [styles.o]: mark.player === "O",
                  [styles.shifted]: shifted && !fallsOff,
                  [styles.fallOff]: shifted && fallsOff,
                })}
                style={{ gridColumn: mark.col + 1, gridRow: mark.row + 1 }}
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
      <span className={styles.caption}>O shifts the grid right</span>
    </div>
  );
};

export default ShiftAnimation;
