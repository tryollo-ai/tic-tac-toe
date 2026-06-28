/**
 * Cross-cutting game/room domain constants shared across utils, components, and
 * the server store. Module-internal tuning (minimax weights, store TTLs) and
 * component-local UI timings stay colocated with their owners.
 */

/** Default board side length for a new game (the classic 3×3). */
export const INITIAL_SIZE = 3;

/**
 * Bounds for the configurable board size and the consecutive run needed to win
 * (see the internal game-config page). A game is always a square board between
 * {@link MIN_BOARD_SIZE} and {@link MAX_BOARD_SIZE} cells per side, and a win is
 * a straight run of at least {@link MIN_WIN_LENGTH} marks, never longer than the
 * board's side. These are the source of truth for both the config UI's controls
 * and the server-side clamping, so the two can't drift.
 */
export const MIN_BOARD_SIZE = 3;
export const MAX_BOARD_SIZE = 10;
export const MIN_WIN_LENGTH = 3;
/** Default consecutive run length needed to win a new game. */
export const DEFAULT_WIN_LENGTH = 3;

/** Sentinel playerId for the AI seat; no human can ever match it. */
export const AI_SEAT = "__AI__";

/**
 * How long a finished game stays on screen before the room resets to a fresh
 * round. Long enough to read the result, short enough to keep play moving.
 *
 * Drives both the server-side lazy reset (`maybeStartNextRound` in the store)
 * and the client countdown bar's CSS `animationDuration` in `RoomGame`, so the
 * timer the user watches and the moment the server actually resets can't drift.
 */
export const AUTO_RESET_MS = 4500;
