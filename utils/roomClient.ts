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

/** Callbacks for a room's Server-Sent Events subscription. */
export type RoomStreamHandlers = {
  /** A fresh room view arrived over the stream. */
  onRoom: (room: RoomView) => void;
  /** The stream connected (or reconnected) successfully. */
  onOpen?: () => void;
  /** The connection dropped; the browser will retry on its own. */
  onError?: () => void;
  /** The server reported the room no longer exists; the stream is closed. */
  onGone?: () => void;
};

/**
 * Subscribe to a room's live updates over Server-Sent Events. The optional
 * `playerId` heartbeats that player's seat for as long as the stream is open,
 * mirroring `fetchRoom`. Returns an unsubscribe function that closes the
 * connection. SSR-safe: a no-op when `EventSource` is unavailable.
 */
export function subscribeRoom(
  id: string,
  playerId: string | null,
  handlers: RoomStreamHandlers,
): () => void {
  if (typeof EventSource === "undefined") return () => {};

  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const source = new EventSource(`/api/rooms/${id}/stream${query}`);

  source.addEventListener("open", () => handlers.onOpen?.());
  source.addEventListener("room", (event) => {
    handlers.onRoom(JSON.parse((event as MessageEvent).data) as RoomView);
  });
  source.addEventListener("gone", () => {
    handlers.onGone?.();
    source.close();
  });
  source.addEventListener("error", () => handlers.onError?.());

  return () => source.close();
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
  playerId: string,
  signal?: AbortSignal,
): Promise<CompletedGameSummary[]> {
  const query = `?playerId=${encodeURIComponent(playerId)}`;
  return getJson<CompletedGameSummary[]>(
    `/api/completed${query}`,
    "games",
    signal,
  );
}

export function fetchCompletedGame(
  id: string,
  playerId: string,
  signal?: AbortSignal,
): Promise<CompletedGameView> {
  const query = `?playerId=${encodeURIComponent(playerId)}`;
  return getJson<CompletedGameView>(`/api/completed/${id}${query}`, "game", signal);
}
