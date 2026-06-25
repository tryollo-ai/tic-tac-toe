import styles from "./styles.module.scss";

export interface Scores {
  X: number;
  O: number;
  draws: number;
}

type Props = {
  scores: Scores;
  xLabel: string;
  oLabel: string;
};

const Scoreboard = (props: Props) => {
  return (
    <div className={styles.root}>
      <div className={`${styles.item} ${styles.x}`}>
        <span className={styles.label}>{props.xLabel}</span>
        <span className={styles.value}>{props.scores.X}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Draws</span>
        <span className={styles.value}>{props.scores.draws}</span>
      </div>
      <div className={`${styles.item} ${styles.o}`}>
        <span className={styles.label}>{props.oLabel}</span>
        <span className={styles.value}>{props.scores.O}</span>
      </div>
    </div>
  );
};

export default Scoreboard;
