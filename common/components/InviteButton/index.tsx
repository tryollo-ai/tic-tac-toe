"use client";

import { useEffect, useState } from "react";
import classNames from "classnames";
import styles from "./styles.module.scss";

type Props = {
  /** The room to invite into; the shareable link is this room's page URL. */
  roomId: string;
};

// How long the "Link copied!" confirmation stays before the button reverts to
// its idle label. Matches the ShiftDebug copy-feedback timing.
const COPIED_FEEDBACK_MS = 1500;

/**
 * Copies a shareable link to the current room to the clipboard so a seated or
 * spectating player can pass it to someone else. The link is built from the
 * live origin + the room's page path, so it stays correct across environments
 * (localhost, preview, prod) without threading a base URL through props.
 */
const InviteButton = (props: Props) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    const link = `${window.location.origin}/room/${props.roomId}`;
    navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <button
      type="button"
      className={classNames(styles.root, { [styles.copied]: copied })}
      onClick={copy}
      aria-label={copied ? "Link copied!" : "Invite player"}
    >
      <span aria-hidden="true">
        {copied ? "Link copied!" : "Invite player"}
      </span>
      <span aria-live="polite" className={styles.srOnly}>
        {copied ? "Link copied!" : ""}
      </span>
    </button>
  );
};

export default InviteButton;
