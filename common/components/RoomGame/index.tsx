"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchGameConfig } from "@/utils/roomClient";
import { useRoom } from "@/lib/useRoom";
import { usePlayerName } from "@/lib/usePlayerName";
import GameView from "./GameView";
import styles from "./styles.module.scss";

type Props = {
  id: string;
};

/**
 * How long the "new round" banner stays on screen after a reset before fading
 * out. Matches the total of its CSS pop-in/hold/fade-out animation. Read from
 * the stylesheet `:export` and handed to {@link useRoom}, keeping scss the
 * single source of truth for the banner duration.
 */
const ROUND_ANNOUNCEMENT_MS = Number(styles.roundAnnouncementMs);

/**
 * Online room container: drives the live, server-backed room via {@link useRoom}
 * and renders it through the shared {@link GameView}. The invite control is shown
 * here (an online room is shareable); the single-device {@link
 * import("@/common/components/LocalGame")} container renders the same view
 * without it.
 */
const RoomGame = (props: Props) => {
  // The player's chosen display name, persisted per browser. Passed to useRoom so
  // it rides along with a seat claim, and to GameView so the name field can edit it.
  const [playerName, setPlayerName] = usePlayerName();
  const game = useRoom(props.id, {
    roundAnnouncementMs: ROUND_ANNOUNCEMENT_MS,
    playerName,
  });
  // The active trick variant (O's trick follows it) so the trick hint matches
  // what a trick will actually do. Shares the lobby's "game-config" query cache.
  const { data: config } = useQuery({
    queryKey: ["game-config"],
    queryFn: ({ signal }) => fetchGameConfig(signal),
  });
  return (
    <GameView
      game={game}
      showInvite
      roomId={props.id}
      trickMode={config?.shiftMode}
      playerName={playerName}
      onPlayerNameChange={setPlayerName}
    />
  );
};

export default RoomGame;
