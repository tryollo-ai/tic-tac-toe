"use client";

import classNames from "classnames";
import { useEffect, useId, useRef, useState } from "react";
import type { GameMode } from "@/common/components/Game/Game";
import Scoreboard, { type Scores } from "@/common/components/Scoreboard/Scoreboard";
import styles from "./styles.module.scss";

interface OverflowMenuProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  scores: Scores;
  xLabel: string;
  oLabel: string;
  onResetScores: () => void;
}

const OverflowMenu = ({
  mode,
  onModeChange,
  scores,
  xLabel,
  oLabel,
  onResetScores,
}: OverflowMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click or Escape while the popover is open.
  useEffect(() => {
    if (!open) return;

    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Menu and settings"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className={styles.popover} id={menuId} role="menu">
          <section className={styles.section}>
            <h2 className={styles.heading}>Scores</h2>
            <Scoreboard scores={scores} xLabel={xLabel} oLabel={oLabel} />
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Mode</h2>
            <div
              className={styles.modeToggle}
              role="group"
              aria-label="Game mode"
            >
              <button
                type="button"
                className={classNames({ [styles.active]: mode === "two-player" })}
                onClick={() => onModeChange("two-player")}
                aria-pressed={mode === "two-player"}
              >
                2 Players
              </button>
              <button
                type="button"
                className={classNames({ [styles.active]: mode === "ai" })}
                onClick={() => onModeChange("ai")}
                aria-pressed={mode === "ai"}
              >
                vs AI
              </button>
            </div>
          </section>

          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              onResetScores();
              setOpen(false);
            }}
          >
            Reset Scores
          </button>

          <p className={styles.about}>
            Built with Next.js. The AI plays a perfect game - the best you can
            do is draw.
          </p>
        </div>
      )}
    </div>
  );
};

export default OverflowMenu;
