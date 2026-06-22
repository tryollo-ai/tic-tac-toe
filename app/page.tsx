import Lobby from "@/components/Lobby/Lobby";
import styles from "./page.module.scss";

export default function Home() {
  return (
    <main className={styles.main}>
      <Lobby />
    </main>
  );
}
