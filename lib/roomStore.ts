import {
  boardAfterMoves,
  calculateWinner,
  chooseAiExtend,
  extendBoard,
  getBestMove,
  INITIAL_SIZE,
  isGameOver,
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
      // A player who vacated forfeits any pending extend choice.
      if (room.awaitingExtend === seat) {
        room.awaitingExtend = null;
        room.xIsNext = !room.xIsNext;
      }
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
    moves: room.moves.slice(),
    extends: room.extendLog.slice(),
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
 * Play the AI's move (and, if worthwhile, its one-time extend) in place. A
 * no-op unless it is the AI's turn in an AI room. Leaves it as the human's turn.
 */
function runAiTurn(room: Room): void {
  if (room.mode !== "ai" || room.xIsNext || room.seats.O !== AI_SEAT) return;
  if (isGameOver(room.board, room.rows, room.cols)) return;

  const move = getBestMove(room.board, room.rows, room.cols, "O");
  if (move === -1) return;
  room.board[move] = "O";
  room.moves.push(move);

  if (!settle(room) && !room.extendUsed.O) {
    const dir = chooseAiExtend(room.board, room.rows, room.cols, "O");
    if (dir) {
      applyExtend(room, dir);
      room.extendUsed.O = true;
    }
  }
  room.xIsNext = true; // hand the turn back to the human
}

/** Grow the board in place in the given direction, recording it for replay. */
function applyExtend(room: Room, direction: Direction): void {
  const ext = extendBoard(room.board, room.rows, room.cols, direction);
  room.board = ext.board;
  room.rows = ext.rows;
  room.cols = ext.cols;
  // `at` = moves played so far, so a replay can re-apply it at the same point.
  room.extendLog.push({ at: room.moves.length, dir: direction });
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
    moves: [],
    xIsNext: true,
    scores: { ...INITIAL_SCORES },
    status: "waiting",
    // In AI mode O is the computer and can never be claimed by a human.
    seats: { X: null, O: mode === "ai" ? AI_SEAT : null },
    mode,
    extendUsed: { X: false, O: false },
    awaitingExtend: null,
    extendLog: [],
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
  const { board, rows, cols } = boardAfterMoves(
    game.moves,
    game.moves.length,
    game.extends,
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
    moves: game.moves,
    extends: game.extends,
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
        // Vacating mid-turn forfeits any pending extend choice.
        if (room.awaitingExtend === seat) {
          room.awaitingExtend = null;
          room.xIsNext = !room.xIsNext;
        }
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
    if (room.awaitingExtend !== null) {
      return { ok: false, error: "awaiting-extend" };
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
    room.moves.push(index);
    if (settle(room)) return touched(room);

    // The mover still has their one extend action: pause for that choice
    // (their move, then their action) before play passes to the opponent.
    if (!room.extendUsed[turn]) {
      room.awaitingExtend = turn;
      return touched(room);
    }

    room.xIsNext = !room.xIsNext;
    runAiTurn(room); // server-side AI follow-up so spectators see it too
    return touched(room);
  });
}

/** Apply the awaiting player's one-time board extension, then continue play. */
export function extendBoardAction(
  id: string,
  direction: Direction,
  playerId: string,
): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);

    const player = room.awaitingExtend;
    if (player === null) {
      return { ok: false, error: "not-awaiting-extend" };
    }
    if (room.seats[player] !== playerId) {
      return { ok: false, error: "not-your-turn" };
    }
    if (room.extendUsed[player]) {
      return { ok: false, error: "extend-used" };
    }

    applyExtend(room, direction);
    room.extendUsed[player] = true;
    room.awaitingExtend = null;
    room.xIsNext = !room.xIsNext;
    runAiTurn(room);
    return touched(room);
  });
}

/** Decline the optional extension for this turn, passing play to the opponent. */
export function skipExtend(id: string, playerId: string): StoreResult {
  return withRoom(id, (room) => {
    sweepSeats(room);

    const player = room.awaitingExtend;
    if (player === null) {
      return { ok: false, error: "not-awaiting-extend" };
    }
    if (room.seats[player] !== playerId) {
      return { ok: false, error: "not-your-turn" };
    }

    // The action is kept for a later turn; only this turn's window is skipped.
    room.awaitingExtend = null;
    room.xIsNext = !room.xIsNext;
    runAiTurn(room);
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
    room.moves = [];
    room.xIsNext = true;
    room.extendUsed = { X: false, O: false };
    room.awaitingExtend = null;
    room.extendLog = [];
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
    case "awaiting-extend":
    case "not-awaiting-extend":
    case "extend-used":
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
