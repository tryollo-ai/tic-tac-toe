"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";
import { boardAfterActions, type GameAction } from "@/utils/gameLogic";
import { describeAction } from "@/utils/historyLabels";
import MiniBoard from "@/common/components/MiniBoard";
import styles from "./styles.module.scss";

type Props = {
  actions: GameAction[];
};

/** How far one arrow press scrolls the list, in pixels. */
const SCROLL_STEP = 140;

/**
 * A faded, hover-revealed column of every prior board state in move order
 * (oldest at top, newest at bottom). Each entry pairs a `MiniBoard` snapshot of
 * the position after that move with a compact label of who moved and what they
 * did. The list is bounded in height and scrolled with up/down arrow buttons
 * that disable at the ends. Renders nothing until there is at least one move.
 */
const BoardHistory = (props: Props) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const moveCount = props.actions.length;

  const updateArrows = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 1);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  // Keep the newest move in view as the game progresses, then refresh the arrow
  // enabled-state for the new content height. The list scrolls vertically on
  // desktop and horizontally on mobile; pinning both axes to their end keeps the
  // newest entry visible in either layout (the inactive axis has no overflow, so
  // its assignment is a no-op).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.scrollLeft = el.scrollWidth;
    updateArrows();
  }, [moveCount, updateArrows]);

  // Re-evaluate the arrows when the panel is resized (e.g. responsive reflow).
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateArrows]);

  const scrollBy = useCallback((delta: number) => {
    listRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  }, []);

  if (moveCount === 0) return null;

  return (
    <aside className={styles.root} aria-label="Move history">
      <p className={styles.header}>History</p>

      <button
        type="button"
        className={styles.arrow}
        onClick={() => scrollBy(-SCROLL_STEP)}
        disabled={!canScrollUp}
        aria-label="Scroll history up"
      >
        ▲
      </button>

      <div className={styles.list} ref={listRef} onScroll={updateArrows}>
        {props.actions.map((action, i) => {
          const { player, move } = describeAction(action, i);
          return (
            <div className={styles.entry} key={i}>
              <span className={styles.moveNo}>{i + 1}</span>
              <MiniBoard board={boardAfterActions(props.actions, i + 1)} />
              <span className={styles.label}>
                <span
                  className={classNames(styles.mark, {
                    [styles.markX]: player === "X",
                    [styles.markO]: player === "O",
                  })}
                >
                  {player}
                </span>
                <span className={styles.move}>{move}</span>
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.arrow}
        onClick={() => scrollBy(SCROLL_STEP)}
        disabled={!canScrollDown}
        aria-label="Scroll history down"
      >
        ▼
      </button>
    </aside>
  );
};

export default BoardHistory;
