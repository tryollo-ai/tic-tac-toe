import type { Direction } from "@/utils/gameLogic";
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

/** Turn a failed response into a RoomError, preferring its error-code body. */
async function errorFrom(res: Response): Promise<RoomError> {
  const body = await res.json().catch(() => ({}));
  return new RoomError(body.error ?? `http-${res.status}`);
}

/** Read one keyed field out of a JSON response, throwing a RoomError on failure. */
async function readField<T>(res: Response, key: string): Promise<T> {
  if (!res.ok) throw await errorFrom(res);
  const body = await res.json();
  return body[key] as T;
}

/** GET a no-store JSON endpoint and return one of its fields. */
function getJson<T>(
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetch(url, { cache: "no-store", signal }).then((res) =>
    readField<T>(res, key),
  );
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
  }).then((res) => readField<RoomView>(res, "room"));
}

export function fetchRooms(signal?: AbortSignal): Promise<RoomSummary[]> {
  return getJson<RoomSummary[]>("/api/rooms", "rooms", signal);
}

export function createRoom(name: string, mode: RoomMode): Promise<RoomView> {
  return sendJson("/api/rooms", "POST", { name, mode });
}

export function fetchRoom(
  id: string,
  playerId: string | null,
  signal?: AbortSignal,
): Promise<RoomView> {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  return getJson<RoomView>(`/api/rooms/${id}${query}`, "room", signal);
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

export function fetchCompletedGames(
  signal?: AbortSignal,
): Promise<CompletedGameSummary[]> {
  return getJson<CompletedGameSummary[]>("/api/completed", "games", signal);
}

export function fetchCompletedGame(
  id: string,
  signal?: AbortSignal,
): Promise<CompletedGameView> {
  return getJson<CompletedGameView>(`/api/completed/${id}`, "game", signal);
}
