import Link from "next/link";
import { modeLabel, type RoomMode } from "@/lib/roomTypes";
import styles from "./styles.module.scss";

type Props = {
  name: string;
  mode: RoomMode;
};

/**
 * The shared top bar for the room and replay views: a back-to-lobby link, the
 * game name, and a mode tag. Both views render an identical header, so it lives
 * here as one component owning the markup and styles.
 */
const RoomHeader = (props: Props) => {
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.back}>
        ← Lobby
      </Link>
      <h1 className={styles.title}>{props.name}</h1>
      <span className={styles.modeTag}>{modeLabel(props.mode)}</span>
    </header>
  );
};

export default RoomHeader;
