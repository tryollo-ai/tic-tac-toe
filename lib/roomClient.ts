import type { RoomMode, RoomSummary, RoomView } from "@/lib/roomTypes";

/** Error carrying the server's machine-readable error code. */
export class RoomError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "RoomError";
  }
}

async function parseRoom(res: Response): Promise<RoomView> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RoomError(body.error ?? `http-${res.status}`);
  }
  const body = await res.json();
  return body.room as RoomView;
}

export async function fetchRooms(signal?: AbortSignal): Promise<RoomSummary[]> {
  const res = await fetch("/api/rooms", { cache: "no-store", signal });
  if (!res.ok) throw new RoomError(`http-${res.status}`);
  const body = await res.json();
  return body.rooms as RoomSummary[];
}

export async function createRoom(
  name: string,
  mode: RoomMode,
): Promise<RoomView> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mode }),
  });
  return parseRoom(res);
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

export async function claimSeat(
  id: string,
  playerId: string,
  seat: "X" | "O",
): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${id}/seat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, seat }),
  });
  return parseRoom(res);
}

export async function leaveSeat(
  id: string,
  playerId: string,
): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${id}/seat`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parseRoom(res);
}

export async function makeMove(
  id: string,
  playerId: string,
  index: number,
): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, index }),
  });
  return parseRoom(res);
}

export async function resetRoom(
  id: string,
  playerId: string,
): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${id}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parseRoom(res);
}
