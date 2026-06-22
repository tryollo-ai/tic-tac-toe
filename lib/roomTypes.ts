import type { Board } from "@/lib/gameLogic";

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

/** Sentinel playerId for the AI seat; no human can ever match it. */
export const AI_SEAT = "__AI__";

/** Short human-readable label for a room's mode. */
export function modeLabel(mode: RoomMode): string {
  return mode === "ai" ? "vs AI" : "2 Player";
}
