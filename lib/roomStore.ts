import {
  boardAfterActions,
  calculateWinner,
  chooseAiAction,
  INITIAL_SIZE,
  isGameOver,
  shiftBoard,
  type Board,
  type Direction,
  type Player,
} from "@/lib/gameLogic";
import {
  AI_SEAT,
  type CompletedGame,
  type CompletedGameSummary,
  type CompletedGameView,
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

const EMPTY_BOARD: Board = Array(INITIAL_SIZE * INITIAL_SIZE).fill(null);
const INITIAL_SCORES: Scores = { X: 0, O: 0, draws: 0 };
/** The two human-claimable seats, in turn order. */
const SEATS = ["X", "O"] as const;

// Stash the maps on globalThis so Next.js dev hot-reload doesn't wipe state.
const g = globalThis as unknown as {
  __tttStore?: {
    rooms: Map<string, Room>;
    completed: Map<string, CompletedGame>;
    seq: number;
  };
};
const store = g.__tttStore ?? {
  rooms: new Map<string, Room>(),
  completed: new Map<string, CompletedGame>(),
  seq: 0,
};
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
  if (isGameOver(room.board, room.rows, room.cols)) {
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

/** Drop archived games older than the idle window, bounding memory. */
function reapIdleCompleted(): void {
  const cutoff = now() - ROOM_IDLE_MS;
  for (const [id, game] of store.completed) {
    if (game.completedAt < cutoff) store.completed.delete(id);
  }
}

/** Snapshot a just-finished game into the completed-games archive. */
function archiveCompletedGame(room: Room): void {
  const game: CompletedGame = {
    id: nextId(),
    roomId: room.id,
    name: room.name,
    mode: room.mode,
    actions: room.actions.slice(),
    completedAt: now(),
  };
  store.completed.set(game.id, game);
}

/** Record a finished round in the scores exactly once. */
function applyOutcome(room: Room): void {
  const result = calculateWinner(room.board, room.rows, room.cols);
  if (result) {
    room.scores[result.winner] += 1;
  } else {
    room.scores.draws += 1;
  }
}

/**
 * If the board is now in a terminal state, score the round and archive it for
 * replay, reporting that the game ended. Does not advance the turn; callers
 * handle turn flow. This is the single point every placement funnels through,
 * so the game is scored and archived exactly once however it ends.
 */
function settle(room: Room): boolean {
  if (isGameOver(room.board, room.rows, room.cols)) {
    applyOutcome(room);
    archiveCompletedGame(room);
    return true;
  }
  return false;
}

/**
 * Take the AI's single action for its turn in place: either place its best move
 * or spend its one-time whole-grid shift, whichever the lookahead prefers. A
 * no-op unless it is the AI's turn in an AI room. Leaves it as the human's turn
 * (unless the AI's placement ended the game).
 */
function runAiTurn(room: Room): void {
  if (room.mode !== "ai" || room.xIsNext || room.seats.O !== AI_SEAT) return;
  if (isGameOver(room.board, room.rows, room.cols)) return;

  const action = chooseAiAction(
    room.board,
    room.rows,
    room.cols,
    !room.oShiftUsed,
  );
  if (!action) return;

  if (action.kind === "shift") {
    applyShift(room, action.dir);
    room.oShiftUsed = true;
  } else {
    room.board[action.index] = "O";
    room.actions.push(action);
    if (settle(room)) return; // AI's placement ended the game
  }
  room.xIsNext = true; // hand the turn back to the human
}

/** Slide the grid in place in the given direction, recording it for replay. */
function applyShift(room: Room, direction: Direction): void {
  room.board = shiftBoard(room.board, room.rows, room.cols, direction);
  room.actions.push({ kind: "shift", dir: direction });
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
        rows: room.rows,
        cols: room.cols,
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
    rows: INITIAL_SIZE,
    cols: INITIAL_SIZE,
    actions: [],
    xIsNext: true,
    scores: { ...INITIAL_SCORES },
    status: "waiting",
    // In AI mode O is the computer and can never be claimed by a human.
    seats: { X: null, O: mode === "ai" ? AI_SEAT : null },
    mode,
    oShiftUsed: false,
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
  const result = calculateWinner(room.board, room.rows, room.cols);
  return { ...room, winningLine: result ? result.line : null };
}

export function toCompletedSummary(game: CompletedGame): CompletedGameSummary {
  const { board, rows, cols } = boardAfterActions(
    game.actions,
    game.actions.length,
  );
  const result = calculateWinner(board, rows, cols);
  return {
    id: game.id,
    name: game.name,
    mode: game.mode,
    board,
    rows,
    cols,
    winner: result ? result.winner : null,
    completedAt: game.completedAt,
  };
}

export function toCompletedView(game: CompletedGame): CompletedGameView {
  return {
    id: game.id,
    name: game.name,
    mode: game.mode,
    actions: game.actions,
    completedAt: game.completedAt,
  };
}

/** Archived finished games, newest first. */
export function listCompletedGames(): CompletedGameSummary[] {
  reapIdleCompleted();
  return Array.from(store.completed.values())
    .sort((a, b) => b.completedAt - a.completedAt)
    .map(toCompletedSummary);
}

export function getCompletedGame(id: string): CompletedGame | null {
  return store.completed.get(id) ?? null;
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

    if (isGameOver(room.board, room.rows, room.cols)) {
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

    room.board[index] = turn;
    room.actions.push({ kind: "place", index });
    if (settle(room)) return touched(room);

    room.xIsNext = !room.xIsNext;
    runAiTurn(room); // server-side AI follow-up so spectators see it too
    return touched(room);
  });
}

/**
 * Apply O's one-time whole-grid shift. Shifting is an alternative to placing a
 * mark and uses up O's turn, so only O may call it, only on O's turn, and only
 * once per game. A shift can never complete a line, so play simply passes to X.
 */
export function shiftBoardAction(
  id: string,
  direction: Direction,
  playerId: string,
): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);

    if (isGameOver(room.board, room.rows, room.cols)) {
      return { ok: false, error: "game-over" };
    }
    // The shift belongs to O, and only on O's turn (it is O's action for it).
    if (room.xIsNext || room.seats.O !== playerId) {
      return { ok: false, error: "not-your-turn" };
    }
    if (room.oShiftUsed) {
      return { ok: false, error: "shift-used" };
    }

    applyShift(room, direction);
    room.oShiftUsed = true;
    room.xIsNext = true; // the shift was O's whole turn; X plays next
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
    room.rows = INITIAL_SIZE;
    room.cols = INITIAL_SIZE;
    room.actions = [];
    room.xIsNext = true;
    room.oShiftUsed = false;
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
    case "shift-used":
      return 409;
    case "not-your-turn":
    case "not-participant":
      return 403;
    case "invalid-index":
    case "invalid-direction":
    case "invalid-name":
      return 400;
    default:
      return 400;
  }
}
