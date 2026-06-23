import type { Board, Player } from "@/lib/gameLogic";

export type RoomMode = "two-player" | "ai";
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

export interface Room {
  id: string;
  name: string;
  board: Board;
  /** Cell indices played this round, in order; X plays even moves, O odd. */
  moves: number[];
  xIsNext: boolean;
  scores: Scores;
  status: RoomStatus;
  seats: Seats;
  mode: RoomMode;
  /** Last-heartbeat timestamp per seat, used for TTL auto-release. */
  seatSeen: { X: number | null; O: number | null };
  createdAt: number;
  lastActivity: number;
}

export interface RoomView extends Room {
  /** Derived at serialization time via calculateWinner, never stored. */
  winningLine: [number, number, number] | null;
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
 * room being reset for a new game or reaped for idleness. The move list is the
 * single source of truth; the board, winner, and winning line are all derived
 * from it via `boardAfterMoves`/`calculateWinner`.
 */
export interface CompletedGame {
  id: string;
  /** The room this game was played in (rooms can produce many over time). */
  roomId: string;
  name: string;
  mode: RoomMode;
  /** Cell indices in play order; X plays even moves, O odd. */
  moves: number[];
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
  moves: number[];
  completedAt: number;
}

/** Sentinel playerId for the AI seat; no human can ever match it. */
export const AI_SEAT = "__AI__";

/** Short human-readable label for a room's mode. */
export function modeLabel(mode: RoomMode): string {
  return mode === "ai" ? "vs AI" : "2 Player";
}
