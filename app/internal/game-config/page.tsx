"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGameConfig, setGameShiftMode } from "@/utils/roomClient";
import {
  shiftBoard,
  type Board,
  type ShiftMode,
} from "@/utils/gameLogic";
import MiniBoard from "@/common/components/MiniBoard";
import Spinner from "@/common/components/Spinner";
import styles from "./page.module.scss";

const GAME_CONFIG_KEY = ["game-config"] as const;

/** The ticket's worked example: the board before O shifts it right. */
const EXAMPLE_BOARD: Board = [
  "X", "O", "O",
  "O", "X", "O",
  "O", "X", null,
];

const MODE_COPY: Record<ShiftMode, { title: string; blurb: string }> = {
  classic: {
    title: "Classic",
    blurb: "Slide the whole grid exactly one cell; marks pushed off the edge are lost.",
  },
  collapse: {
    title: "Collapse",
    blurb:
      "Slide every mark as far as it goes; X ploughs through and removes O marks in its path, O is blocked by X.",
  },
};

/**
 * Internal POC tool at /internal/game-config for toggling the experimental
 * shift behaviour on and off. Deliberately unauthenticated - anyone can flip it.
 */
const GameConfigPage = () => {
  const queryClient = useQueryClient();

  const { data: shiftMode, isPending } = useQuery({
    queryKey: GAME_CONFIG_KEY,
    queryFn: ({ signal }) => fetchGameConfig(signal),
  });

  const mutation = useMutation({
    mutationFn: setGameShiftMode,
    onSuccess: (mode) => queryClient.setQueryData(GAME_CONFIG_KEY, mode),
  });

  if (isPending || !shiftMode) {
    return (
      <main className={styles.main}>
        <Spinner label="Loading config" />
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>Game config</h1>
        <p className={styles.subtitle}>
          Internal POC controls. Changes apply to new shifts only; games already
          played keep the rules they were played with.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>O&rsquo;s shift behaviour</h2>
        <div className={styles.toggle} role="group" aria-label="Shift mode">
          {(Object.keys(MODE_COPY) as ShiftMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={styles.option}
              aria-pressed={shiftMode === mode}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(mode)}
            >
              <span className={styles.optionTitle}>{MODE_COPY[mode].title}</span>
              <span className={styles.optionBlurb}>{MODE_COPY[mode].blurb}</span>
            </button>
          ))}
        </div>
        <p className={styles.active}>
          Active mode: <strong>{MODE_COPY[shiftMode].title}</strong>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Shift right, side by side</h2>
        <p className={styles.subtitle}>
          The same starting board shifted right under each mode.
        </p>
        <div className={styles.examples}>
          <figure className={styles.example}>
            <MiniBoard board={EXAMPLE_BOARD} />
            <figcaption>Before</figcaption>
          </figure>
          <figure className={styles.example}>
            <MiniBoard board={shiftBoard(EXAMPLE_BOARD, "right", "classic")} />
            <figcaption>Classic →</figcaption>
          </figure>
          <figure className={styles.example}>
            <MiniBoard board={shiftBoard(EXAMPLE_BOARD, "right", "collapse")} />
            <figcaption>Collapse →</figcaption>
          </figure>
        </div>
      </section>
    </main>
  );
};

export default GameConfigPage;
