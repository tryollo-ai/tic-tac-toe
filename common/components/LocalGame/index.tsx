"use client";

import { useLocalGame, type LocalGameConfig } from "@/lib/useLocalGame";
import type { LocalMode } from "@/lib/localGameEngine";
import GameView from "@/common/components/RoomGame/GameView";

type Props = {
  mode: LocalMode;
  config: LocalGameConfig;
  name: string;
};

/**
 * Single-device game container: drives a local pass-and-play or vs-AI game
 * entirely in the browser via {@link useLocalGame} and renders it through the
 * shared {@link GameView}. No server room is ever created, so there is no invite
 * control and nothing is tracked - the game lives and dies with this page.
 */
const LocalGame = (props: Props) => {
  const game = useLocalGame(props.mode, props.config, props.name);
  return (
    <GameView
      game={game}
      showInvite={false}
      trickMode={props.config.shiftMode}
    />
  );
};

export default LocalGame;
