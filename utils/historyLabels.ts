import { INITIAL_SIZE } from "@/constants/game";
import type { Direction, GameAction, Player } from "@/utils/gameLogic";

/**
 * A compact, human-readable summary of a single history action: which player
 * moved and what they did. `player` is derived from the action's position in the
 * ordered log (X takes the even indices, O the odd ones), and `move` is a short,
 * unambiguous description of the move - a named cell for a placement (e.g.
 * "center", "top-left") or "shift <direction>" for O's grid shift.
 */
export type ActionSummary = {
  player: Player;
  move: string;
};

/** Plain-word direction for O's grid shift, as shown in the history. */
const SHIFT_WORDS: Record<Direction, string> = {
  top: "up",
  bottom: "down",
  left: "left",
  right: "right",
};

/**
 * Name a flat cell index on a `size`×`size` board, e.g. 0 → "top-left",
 * 1 → "top", 4 → "center" on the classic 3×3. The friendly grid names only make
 * sense there, so any other size falls back to a 1-based "cell N".
 */
export function cellName(index: number, size: number = INITIAL_SIZE): string {
  if (size !== 3) return `cell ${index + 1}`;
  const row = Math.floor(index / size);
  const col = index % size;
  if (row === 1 && col === 1) return "center";
  const vertical = row === 0 ? "top" : row === 2 ? "bottom" : "";
  const horizontal = col === 0 ? "left" : col === 2 ? "right" : "";
  return [vertical, horizontal].filter(Boolean).join("-");
}

/**
 * Summarize the action at position `index` in a game's ordered action log:
 * the player who moved (X on even indices, O on odd) and a compact description
 * of the move (a named cell for a placement, or "shift <direction>").
 */
export function describeAction(
  action: GameAction,
  index: number,
  size: number = INITIAL_SIZE,
): ActionSummary {
  const player: Player = index % 2 === 0 ? "X" : "O";
  const move =
    action.kind === "place"
      ? cellName(action.index, size)
      : `shift ${SHIFT_WORDS[action.dir]}`;
  return { player, move };
}

/**
 * A full-sentence narration of the action at `index`, for the replay's per-move
 * caption: e.g. "X marked center" for a placement, or "O shifted the grid down"
 * for O's whole-grid shift - the latter spelled out so a shift turn never reads
 * as a no-op.
 */
export function actionSentence(
  action: GameAction,
  index: number,
  size: number = INITIAL_SIZE,
): string {
  const player: Player = index % 2 === 0 ? "X" : "O";
  return action.kind === "place"
    ? `${player} marked ${cellName(action.index, size)}`
    : `${player} shifted the grid ${SHIFT_WORDS[action.dir]}`;
}
