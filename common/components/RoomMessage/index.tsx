import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./styles.module.scss";

/**
 * Centered placeholder shown while a room or completed game is still loading
 * (or failed to load). The caller supplies the message text.
 */
export const RoomLoading = (props: { children: ReactNode }) => (
  <div className={styles.loading}>{props.children}</div>
);

type NotFoundProps = {
  title: string;
  hint: ReactNode;
};

/**
 * Centered "no longer exists" card with a link back to the lobby, shared by the
 * room and replay views (which differ only in their title and hint copy).
 */
const RoomNotFound = (props: NotFoundProps) => (
  <div className={styles.notFound}>
    <p className={styles.notFoundTitle}>{props.title}</p>
    <p className={styles.notFoundHint}>{props.hint}</p>
    <Link href="/" className={styles.backLink}>
      Back to lobby
    </Link>
  </div>
);

export default RoomNotFound;
