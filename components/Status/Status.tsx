import styles from "./styles.module.scss";

export type StatusTone = "x" | "o" | "draw" | "neutral";

/** Maps a player to their status tone. */
export const playerTone = (player: "X" | "O"): StatusTone =>
  player === "X" ? "x" : "o";

interface StatusProps {
  message: string;
  tone: StatusTone;
}

export default function Status({ message, tone }: StatusProps) {
  const toneClass: Record<StatusTone, string> = {
    x: styles.x,
    o: styles.o,
    draw: styles.draw,
    neutral: "",
  };

  return (
    <div className={`${styles.status} ${toneClass[tone]}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
