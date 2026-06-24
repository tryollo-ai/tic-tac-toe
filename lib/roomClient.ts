import type { Direction } from "@/lib/gameLogic";
import type {
  CompletedGameSummary,
  CompletedGameView,
  RoomMode,
  RoomSummary,
  RoomView,
} from "@/lib/roomTypes";

/** Error carrying the server's machine-readable error code. */
export class RoomError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "RoomError";
  }
}

/** Extract a thrown error's machine-readable code, or "unknown". */
export function roomErrorCode(err: unknown): string {
  return err instanceof RoomError ? err.code : "unknown";
}

async function parseRoom(res: Response): Promise<RoomView> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RoomError(body.error ?? `http-${res.status}`);
  }
  const body = await res.json();
  return body.room as RoomView;
}

/** Send a JSON-bodied mutation and return the resulting room view. */
function sendJson(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
): Promise<RoomView> {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(parseRoom);
}

export async function fetchRooms(signal?: AbortSignal): Promise<RoomSummary[]> {
  const res = await fetch("/api/rooms", { cache: "no-store", signal });
  if (!res.ok) throw new RoomError(`http-${res.status}`);
  const body = await res.json();
  return body.rooms as RoomSummary[];
}

export function createRoom(name: string, mode: RoomMode): Promise<RoomView> {
  return sendJson("/api/rooms", "POST", { name, mode });
}

export async function fetchRoom(
  id: string,
  playerId: string | null,
  signal?: AbortSignal,
): Promise<RoomView> {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const res = await fetch(`/api/rooms/${id}${query}`, {
    cache: "no-store",
    signal,
  });
  return parseRoom(res);
}

export function claimSeat(
  id: string,
  playerId: string,
  seat: "X" | "O",
): Promise<RoomView> {
  return sendJson(`/api/rooms/${id}/seat`, "POST", { playerId, seat });
}

export function leaveSeat(id: string, playerId: string): Promise<RoomView> {
  return sendJson(`/api/rooms/${id}/seat`, "DELETE", { playerId });
}

export function makeMove(
  id: string,
  playerId: string,
  index: number,
): Promise<RoomView> {
  return sendJson(`/api/rooms/${id}/move`, "POST", { playerId, index });
}

export function resetRoom(id: string, playerId: string): Promise<RoomView> {
  return sendJson(`/api/rooms/${id}/reset`, "POST", { playerId });
}

export function shiftRoom(
  id: string,
  playerId: string,
  direction: Direction,
): Promise<RoomView> {
  return sendJson(`/api/rooms/${id}/shift`, "POST", { playerId, direction });
}

export async function fetchCompletedGames(
  signal?: AbortSignal,
): Promise<CompletedGameSummary[]> {
  const res = await fetch("/api/completed", { cache: "no-store", signal });
  if (!res.ok) throw new RoomError(`http-${res.status}`);
  const body = await res.json();
  return body.games as CompletedGameSummary[];
}

export async function fetchCompletedGame(
  id: string,
  signal?: AbortSignal,
): Promise<CompletedGameView> {
  const res = await fetch(`/api/completed/${id}`, { cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RoomError(body.error ?? `http-${res.status}`);
  }
  const body = await res.json();
  return body.game as CompletedGameView;
}
