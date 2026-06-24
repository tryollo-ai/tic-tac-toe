import styles from "./styles.module.scss";

export interface Scores {
  X: number;
  O: number;
  draws: number;
}

interface ScoreboardProps {
  scores: Scores;
  xLabel: string;
  oLabel: string;
}

const Scoreboard = ({ scores, xLabel, oLabel }: ScoreboardProps) => {
  return (
    <div className={styles.scoreboard}>
      <div className={`${styles.item} ${styles.x}`}>
        <span className={styles.label}>{xLabel}</span>
        <span className={styles.value}>{scores.X}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Draws</span>
        <span className={styles.value}>{scores.draws}</span>
      </div>
      <div className={`${styles.item} ${styles.o}`}>
        <span className={styles.label}>{oLabel}</span>
        <span className={styles.value}>{scores.O}</span>
      </div>
    </div>
  );
};

export default Scoreboard;
