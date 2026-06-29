import type { Board, GameAction, Player } from "@/utils/gameLogic";

export type RoomMode = "two-player" | "ai" | "local";
export type RoomStatus = "waiting" | "in-progress" | "finished";

/** Each seat holds a playerId, the sentinel "__AI__", or null when open. */
export interface Seats {
  X: string | null;
  O: string | null;
}

export interface Scores {
  X: number;
  O: number;
  draws: number;
}

/**
 * A player's lifetime record across every archived game they took part in,
 * tallied per player (not per seat) so it follows the person across the X/O
 * seat swap. Derived on the server from the completed-games archive.
 */
export interface PlayerStats {
  won: number;
  lost: number;
  drawn: number;
}

export interface Room {
  id: string;
  name: string;
  board: Board;
  /** Board side length, fixed for the room's life at creation. */
  size: number;
  /** Consecutive run needed to win, fixed for the room's life at creation. */
  winLength: number;
  /** Every action this round, in turn order; X takes even indices, O odd. */
  actions: GameAction[];
  xIsNext: boolean;
  scores: Scores;
  seats: Seats;
  mode: RoomMode;
  /** Whether O has spent its one-time whole-grid shift this round. */
  oShiftUsed: boolean;
  /** Whether X has spent its one-time (conditional, classic-only) grid shift this round. */
  xShiftUsed: boolean;
  /** Last-heartbeat timestamp per seat, used for TTL auto-release. */
  seatSeen: { X: number | null; O: number | null };
  createdAt: number;
  lastActivity: number;
}

export interface RoomView extends Room {
  /** Derived at serialization time from the board, never stored. */
  status: RoomStatus;
  /** Derived at serialization time via calculateWinner, never stored. Its length
   *  is the room's win run length. */
  winningLine: number[] | null;
  /**
   * How many people are currently watching this room (seated players included),
   * counted from live viewer-presence heartbeats at serialization time. Omitted
   * on views that don't track presence (the client-only local/AI games), where
   * a viewer count is meaningless.
   */
  viewerCount?: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  board: Board;
  status: RoomStatus;
  mode: RoomMode;
  seatsTaken: { X: boolean; O: boolean };
}

/**
 * An archived game that has finished and can no longer be played, only replayed
 * turn by turn. Stored independently of its originating room, so it survives the
 * room being reset for a new game or reaped for idleness. The ordered action log
 * is the single source of truth; the final board, winner, and winning line are
 * all derived from it via `boardAfterActions`/`calculateWinner`.
 */
export interface CompletedGame {
  id: string;
  /** The room this game was played in (rooms can produce many over time). */
  roomId: string;
  name: string;
  mode: RoomMode;
  /** Board side length and win run length the game was played at, so its replay
   *  rebuilds at the right size and scores wins by the right rule. */
  size: number;
  winLength: number;
  /** Every action in play order; X takes even indices, O odd. */
  actions: GameAction[];
  /**
   * Seat holders at archive time (O is the AI sentinel in AI rooms). Null for
   * games archived before participants were recorded; those belong to no player
   * and are never listed. Used only to scope the list to a player; never sent to
   * the replay view.
   */
  playerX: string | null;
  playerO: string | null;
  completedAt: number;
}

/** Compact archived-game shape for the lobby's completed-games list. */
export interface CompletedGameSummary {
  id: string;
  name: string;
  mode: RoomMode;
  /** Final board, for a preview. */
  board: Board;
  /** Winning player, or null for a draw. */
  winner: Player | null;
  completedAt: number;
}

/** Full archived game sent to the replay view. */
export interface CompletedGameView {
  id: string;
  name: string;
  mode: RoomMode;
  /** Board side length and win run length, so the replay rebuilds the board at
   *  the right size and highlights wins by the right rule. */
  size: number;
  winLength: number;
  /** Every action in play order; X takes even indices, O odd. */
  actions: GameAction[];
  completedAt: number;
}

/** Short human-readable label for a room's mode. */
export function modeLabel(mode: RoomMode): string {
  switch (mode) {
    case "ai":
      return "vs AI";
    case "local":
      return "Local 2P";
    default:
      return "2 Player";
  }
}
