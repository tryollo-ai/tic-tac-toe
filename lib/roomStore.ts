import {
  calculateWinner,
  getBestMove,
  isGameOver,
  type Board,
  type Player,
} from "@/lib/gameLogic";
import {
  AI_SEAT,
  type Room,
  type RoomMode,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type Scores,
} from "@/lib/roomTypes";

/** A seat with no heartbeat for this long is auto-released. */
const SEAT_TTL_MS = 30_000;
/** Rooms idle longer than this are reaped lazily on list/create. */
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

const EMPTY_BOARD: Board = Array(9).fill(null);
const INITIAL_SCORES: Scores = { X: 0, O: 0, draws: 0 };
/** The two human-claimable seats, in turn order. */
const SEATS = ["X", "O"] as const;

// Stash the map on globalThis so Next.js dev hot-reload doesn't wipe rooms.
const g = globalThis as unknown as {
  __tttStore?: { rooms: Map<string, Room>; seq: number };
};
const store = g.__tttStore ?? { rooms: new Map<string, Room>(), seq: 0 };
if (!g.__tttStore) g.__tttStore = store;

export type StoreResult =
  | { ok: true; room: Room }
  | { ok: false; error: string };

function now(): number {
  return Date.now();
}

function nextId(): string {
  store.seq += 1;
  return `r${store.seq.toString(36)}${now().toString(36)}`;
}

/** Recompute status from the board and seats. */
function recomputeStatus(room: Room): void {
  if (isGameOver(room.board)) {
    room.status = "finished";
  } else if (room.board.some((cell) => cell !== null)) {
    room.status = "in-progress";
  } else {
    room.status = "waiting";
  }
}

/** Release any human seat whose heartbeat is older than the TTL. */
function sweepSeats(room: Room): void {
  const cutoff = now() - SEAT_TTL_MS;
  SEATS.forEach((seat) => {
    const holder = room.seats[seat];
    if (holder === null || holder === AI_SEAT) return;
    const seen = room.seatSeen[seat];
    if (seen === null || seen < cutoff) {
      room.seats[seat] = null;
      room.seatSeen[seat] = null;
    }
  });
}

/** Drop rooms that have been idle for too long, bounding memory. */
function reapIdleRooms(): void {
  const cutoff = now() - ROOM_IDLE_MS;
  for (const [id, room] of store.rooms) {
    if (room.lastActivity < cutoff) store.rooms.delete(id);
  }
}

/** Record a finished round in the scores exactly once. */
function applyOutcome(room: Room): void {
  const result = calculateWinner(room.board);
  if (result) {
    room.scores[result.winner] += 1;
  } else {
    room.scores.draws += 1;
  }
}

/** Apply a single move in place, scoring the round if it ends the game. */
function placeMark(room: Room, index: number, mark: Player): void {
  room.board[index] = mark;
  room.xIsNext = !room.xIsNext;
  if (isGameOver(room.board)) {
    applyOutcome(room);
  }
}

/** Stamp the room's activity, refresh its status, and return a success result. */
function touched(room: Room): StoreResult {
  room.lastActivity = now();
  recomputeStatus(room);
  return { ok: true, room };
}

/** Look up a room by id, returning a not-found error if it is missing. */
function withRoom(
  id: string,
  fn: (room: Room) => StoreResult,
): StoreResult {
  const room = store.rooms.get(id);
  if (!room) return { ok: false, error: "room-not-found" };
  return fn(room);
}

export function listRooms(): RoomSummary[] {
  reapIdleRooms();
  return Array.from(store.rooms.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((room) => {
      sweepSeats(room);
      recomputeStatus(room);
      return {
        id: room.id,
        name: room.name,
        board: room.board,
        status: room.status,
        mode: room.mode,
        seatsTaken: {
          X: room.seats.X !== null,
          O: room.seats.O !== null,
        },
      };
    });
}

export function createRoom(name: string, mode: RoomMode): StoreResult {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) {
    return { ok: false, error: "invalid-name" };
  }
  reapIdleRooms();
  const ts = now();
  const room: Room = {
    id: nextId(),
    name: trimmed,
    board: EMPTY_BOARD.slice(),
    xIsNext: true,
    scores: { ...INITIAL_SCORES },
    status: "waiting",
    // In AI mode O is the computer and can never be claimed by a human.
    seats: { X: null, O: mode === "ai" ? AI_SEAT : null },
    mode,
    seatSeen: { X: null, O: null },
    createdAt: ts,
    lastActivity: ts,
  };
  store.rooms.set(room.id, room);
  return { ok: true, room };
}

/**
 * Look up a room, sweeping expired seats and refreshing status first. An
 * optional heartbeat playerId bumps the seatSeen of any seat that player holds.
 */
export function getRoom(id: string, heartbeatPlayerId?: string): Room | null {
  const room = store.rooms.get(id);
  if (!room) return null;
  sweepSeats(room);
  if (heartbeatPlayerId) {
    SEATS.forEach((seat) => {
      if (room.seats[seat] === heartbeatPlayerId) {
        room.seatSeen[seat] = now();
      }
    });
  }
  recomputeStatus(room);
  return room;
}

export function toView(room: Room): RoomView {
  const result = calculateWinner(room.board);
  return { ...room, winningLine: result ? result.line : null };
}

export function claimSeat(
  id: string,
  seat: "X" | "O",
  playerId: string,
): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);

    const holder = room.seats[seat];
    if (holder === playerId) {
      // Idempotent re-claim of a seat you already hold.
      room.seatSeen[seat] = now();
      return touched(room);
    }
    if (holder !== null) {
      return { ok: false, error: "seat-taken" };
    }

    room.seats[seat] = playerId;
    room.seatSeen[seat] = now();
    return touched(room);
  });
}

export function leaveSeat(id: string, playerId: string): StoreResult {
  return withRoom(id, (room) => {
    SEATS.forEach((seat) => {
      if (room.seats[seat] === playerId) {
        room.seats[seat] = null;
        room.seatSeen[seat] = null;
      }
    });
    return touched(room);
  });
}

export function makeMove(
  id: string,
  index: number,
  playerId: string,
): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);

    if (isGameOver(room.board)) {
      return { ok: false, error: "game-over" };
    }
    if (index < 0 || index >= room.board.length) {
      return { ok: false, error: "invalid-index" };
    }

    const turn: Player = room.xIsNext ? "X" : "O";
    if (room.seats[turn] !== playerId) {
      return { ok: false, error: "not-your-turn" };
    }
    if (room.board[index] !== null) {
      return { ok: false, error: "cell-taken" };
    }

    placeMark(room, index, turn);

    // Server-side AI follow-up so spectators see the move too.
    if (
      room.mode === "ai" &&
      !room.xIsNext &&
      !isGameOver(room.board) &&
      room.seats.O === AI_SEAT
    ) {
      const aiMove = getBestMove(room.board, "O");
      if (aiMove !== -1) placeMark(room, aiMove, "O");
    }

    return touched(room);
  });
}

export function resetGame(id: string, playerId: string): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);
    if (room.seats.X !== playerId && room.seats.O !== playerId) {
      return { ok: false, error: "not-participant" };
    }
    room.board = EMPTY_BOARD.slice();
    room.xIsNext = true;
    return touched(room);
  });
}

/** Maps a store error code to an HTTP status. */
export function errorStatus(error: string): number {
  switch (error) {
    case "room-not-found":
      return 404;
    case "seat-taken":
      return 409;
    case "cell-taken":
    case "game-over":
      return 409;
    case "not-your-turn":
    case "not-participant":
      return 403;
    case "invalid-index":
    case "invalid-name":
      return 400;
    default:
      return 400;
  }
}
