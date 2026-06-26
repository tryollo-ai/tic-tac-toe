import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  CompletedGame as CompletedRow,
  Room as RoomRow,
} from "@prisma/client";
import { AI_SEAT, INITIAL_SIZE } from "@/constants/game";
import prisma from "@/lib/prisma";
import {
  boardAfterActions,
  calculateWinner,
  chooseAiAction,
  isGameOver,
  shiftBoard,
  type Board,
  type Direction,
  type Player,
} from "@/utils/gameLogic";
import {
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

export type StoreResult =
  | { ok: true; room: Room }
  | { ok: false; error: string };

/**
 * Collects games archived during a mutation so the enclosing transaction can
 * persist them atomically alongside the room update. Mutators call this instead
 * of writing to the database directly, keeping all writes inside one transaction.
 */
type Archive = (game: CompletedGame) => void;

/** A read-modify-write over a single (already locked) room. */
type Mutator = (room: Room, archive: Archive) => StoreResult;

function now(): number {
  return Date.now();
}

function nextId(): string {
  return randomUUID();
}

// --- Prisma row <-> domain mappers -----------------------------------------
//
// The domain `Room`/`CompletedGame` types keep timestamps as epoch-ms numbers
// and nest scores/seats/seatSeen, so every existing pure helper (computeStatus,
// toView, sweepSeats, ...) and the client-facing JSON shape stay unchanged. The
// database instead stores `timestamptz` columns and flat scalar columns, so all
// conversion happens here at the store boundary: rows -> domain on read, domain
// -> columns on write.

const dateToMs = (value: Date | null): number | null =>
  value === null ? null : value.getTime();

const msToDate = (value: number | null): Date | null =>
  value === null ? null : new Date(value);

/** Cast a domain value into the JSON column input type (board/actions). */
const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function rowToRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    board: row.board as Board,
    actions: row.actions as Room["actions"],
    xIsNext: row.xIsNext,
    scores: { X: row.scoreX, O: row.scoreO, draws: row.scoreDraws },
    seats: { X: row.seatX, O: row.seatO },
    mode: row.mode as RoomMode,
    oShiftUsed: row.oShiftUsed,
    seatSeen: { X: dateToMs(row.seatSeenX), O: dateToMs(row.seatSeenO) },
    createdAt: row.createdAt.getTime(),
    lastActivity: row.lastActivity.getTime(),
  };
}

/** Mutable column payload shared by room create and update. */
function roomToData(room: Room) {
  return {
    name: room.name,
    board: asJson(room.board),
    actions: asJson(room.actions),
    xIsNext: room.xIsNext,
    scoreX: room.scores.X,
    scoreO: room.scores.O,
    scoreDraws: room.scores.draws,
    seatX: room.seats.X,
    seatO: room.seats.O,
    seatSeenX: msToDate(room.seatSeen.X),
    seatSeenO: msToDate(room.seatSeen.O),
    mode: room.mode,
    oShiftUsed: room.oShiftUsed,
    lastActivity: msToDate(room.lastActivity) as Date,
  };
}

function rowToCompleted(row: CompletedRow): CompletedGame {
  return {
    id: row.id,
    roomId: row.roomId,
    name: row.name,
    mode: row.mode as RoomMode,
    actions: row.actions as CompletedGame["actions"],
    completedAt: row.completedAt.getTime(),
  };
}

function completedToData(game: CompletedGame) {
  return {
    id: game.id,
    roomId: game.roomId,
    name: game.name,
    mode: game.mode,
    actions: asJson(game.actions),
    completedAt: new Date(game.completedAt),
  };
}

/** Derive the room's status from its board. */
function computeStatus(board: Board): RoomStatus {
  if (isGameOver(board)) return "finished";
  if (board.some((cell) => cell !== null)) return "in-progress";
  return "waiting";
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

/**
 * Drop rooms idle past the window, bounding table size. Uses a `timestamptz`
 * interval comparison (`last_activity < now() - ttl`) so the cutoff is evaluated
 * by the database, not against epoch-ms numbers.
 */
async function reapIdleRooms(): Promise<void> {
  const cutoff = new Date(now() - ROOM_IDLE_MS);
  await prisma.room.deleteMany({ where: { lastActivity: { lt: cutoff } } });
}

/** Drop archived games older than the idle window, bounding table size. */
async function reapIdleCompleted(): Promise<void> {
  const cutoff = new Date(now() - ROOM_IDLE_MS);
  await prisma.completedGame.deleteMany({
    where: { completedAt: { lt: cutoff } },
  });
}

/** Snapshot a just-finished game into the completed-games archive. */
function archiveCompletedGame(room: Room, archive: Archive): void {
  archive({
    id: nextId(),
    roomId: room.id,
    name: room.name,
    mode: room.mode,
    actions: room.actions.slice(),
    completedAt: now(),
  });
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

/**
 * If the board is now in a terminal state, score the round and archive it for
 * replay, reporting that the game ended. Does not advance the turn; callers
 * handle turn flow. This is the single point every placement funnels through,
 * so the game is scored and archived exactly once however it ends.
 */
function settle(room: Room, archive: Archive): boolean {
  if (isGameOver(room.board)) {
    applyOutcome(room);
    archiveCompletedGame(room, archive);
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
function runAiTurn(room: Room, archive: Archive): void {
  if (room.mode !== "ai" || room.xIsNext || room.seats.O !== AI_SEAT) return;
  if (isGameOver(room.board)) return;

  const action = chooseAiAction(room.board, !room.oShiftUsed);
  if (!action) return;

  if (action.kind === "shift") {
    applyShift(room, action.dir);
    room.oShiftUsed = true;
  } else {
    room.board[action.index] = "O";
    room.actions.push(action);
    if (settle(room, archive)) return; // AI's placement ended the game
  }
  room.xIsNext = true; // hand the turn back to the human
}

/** Slide the grid in place in the given direction, recording it for replay. */
function applyShift(room: Room, direction: Direction): void {
  room.board = shiftBoard(room.board, direction);
  room.actions.push({ kind: "shift", dir: direction });
}

/** Stamp the room's activity and return a success result. */
function touched(room: Room): StoreResult {
  room.lastActivity = now();
  return { ok: true, room };
}

/**
 * Run a read-modify-write against one room inside a Prisma interactive
 * transaction that row-locks it for the whole transaction.
 *
 * Concurrency: once room state is shared across serverless instances, the
 * single-threaded "mutate one object in place" guarantee is gone - two requests
 * on the same room could read, mutate, and write over each other. Every mutation
 * therefore funnels through here. The opening `SELECT id ... FOR UPDATE` takes a
 * Postgres row lock that is held until the transaction commits, so a second
 * concurrent request on the same room blocks on that lock and only proceeds
 * once the first has committed - then re-reads the just-written state (READ
 * COMMITTED). Reads, the mutation, and the write all happen inside the one
 * locked transaction, so they are effectively serialized per room. Games
 * archived by the mutator are inserted in the same transaction, so a finished
 * game is scored and persisted atomically with the room update.
 */
async function withRoomTx(id: string, mutate: Mutator): Promise<StoreResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM rooms WHERE id = ${id} FOR UPDATE
    `;
    if (locked.length === 0) return { ok: false, error: "room-not-found" };

    const row = await tx.room.findUniqueOrThrow({ where: { id } });
    const room = rowToRoom(row);

    const archived: CompletedGame[] = [];
    const result = mutate(room, (game) => archived.push(game));
    if (!result.ok) return result; // failed guard: no writes, lock released on commit

    await tx.room.update({ where: { id }, data: roomToData(result.room) });
    if (archived.length > 0) {
      await tx.completedGame.createMany({
        data: archived.map(completedToData),
      });
    }
    return result;
  });
}

export async function listRooms(): Promise<RoomSummary[]> {
  await reapIdleRooms();
  const rows = await prisma.room.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => {
    const room = rowToRoom(row);
    // Sweep expired seats for the summary; the release is persisted lazily the
    // next time the room is mutated or heartbeated under its row lock.
    sweepSeats(room);
    return {
      id: room.id,
      name: room.name,
      board: room.board,
      status: computeStatus(room.board),
      mode: room.mode,
      seatsTaken: {
        X: room.seats.X !== null,
        O: room.seats.O !== null,
      },
    };
  });
}

export async function createRoom(
  name: string,
  mode: RoomMode,
): Promise<StoreResult> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) {
    return { ok: false, error: "invalid-name" };
  }
  await reapIdleRooms();
  const ts = now();
  const room: Room = {
    id: nextId(),
    name: trimmed,
    board: EMPTY_BOARD.slice(),
    actions: [],
    xIsNext: true,
    scores: { ...INITIAL_SCORES },
    // In AI mode O is the computer and can never be claimed by a human.
    seats: { X: null, O: mode === "ai" ? AI_SEAT : null },
    mode,
    oShiftUsed: false,
    seatSeen: { X: null, O: null },
    createdAt: ts,
    lastActivity: ts,
  };
  await prisma.room.create({
    data: { id: room.id, createdAt: new Date(ts), ...roomToData(room) },
  });
  return { ok: true, room };
}

/**
 * Look up a room, sweeping expired seats and refreshing status first. An
 * optional heartbeat playerId bumps the seatSeen of any seat that player holds.
 *
 * Without a heartbeat this is a plain read. With a heartbeat it is a
 * read-modify-write (it bumps seatSeen), so it runs under the room lock via
 * `withRoomTx` and persists the swept/heartbeated seat state.
 */
export async function getRoom(
  id: string,
  heartbeatPlayerId?: string,
): Promise<Room | null> {
  if (!heartbeatPlayerId) {
    const row = await prisma.room.findUnique({ where: { id } });
    if (!row) return null;
    const room = rowToRoom(row);
    sweepSeats(room);
    return room;
  }

  const result = await withRoomTx(id, (room) => {
    sweepSeats(room);
    SEATS.forEach((seat) => {
      if (room.seats[seat] === heartbeatPlayerId) {
        room.seatSeen[seat] = now();
      }
    });
    // A heartbeat is not room activity, so do not bump lastActivity (touched).
    return { ok: true, room };
  });
  return result.ok ? result.room : null;
}

export function toView(room: Room): RoomView {
  const result = calculateWinner(room.board);
  return {
    ...room,
    status: computeStatus(room.board),
    winningLine: result ? result.line : null,
  };
}

export function toCompletedSummary(game: CompletedGame): CompletedGameSummary {
  const board = boardAfterActions(game.actions, game.actions.length);
  const result = calculateWinner(board);
  return {
    id: game.id,
    name: game.name,
    mode: game.mode,
    board,
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
export async function listCompletedGames(): Promise<CompletedGameSummary[]> {
  await reapIdleCompleted();
  const rows = await prisma.completedGame.findMany({
    orderBy: { completedAt: "desc" },
  });
  return rows.map((row) => toCompletedSummary(rowToCompleted(row)));
}

export async function getCompletedGame(
  id: string,
): Promise<CompletedGame | null> {
  const row = await prisma.completedGame.findUnique({ where: { id } });
  return row ? rowToCompleted(row) : null;
}

export async function claimSeat(
  id: string,
  seat: "X" | "O",
  playerId: string,
): Promise<StoreResult> {
  return withRoomTx(id, (room) => {
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

export async function leaveSeat(
  id: string,
  playerId: string,
): Promise<StoreResult> {
  return withRoomTx(id, (room) => {
    SEATS.forEach((seat) => {
      if (room.seats[seat] === playerId) {
        room.seats[seat] = null;
        room.seatSeen[seat] = null;
      }
    });
    return touched(room);
  });
}

export async function makeMove(
  id: string,
  index: number,
  playerId: string,
): Promise<StoreResult> {
  return withRoomTx(id, (room, archive) => {
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

    room.board[index] = turn;
    room.actions.push({ kind: "place", index });
    if (settle(room, archive)) return touched(room);

    room.xIsNext = !room.xIsNext;
    runAiTurn(room, archive); // server-side AI follow-up so spectators see it too
    return touched(room);
  });
}

/**
 * Apply O's one-time whole-grid shift. Shifting is an alternative to placing a
 * mark and uses up O's turn, so only O may call it, only on O's turn, and only
 * once per game. A shift can never complete a line, so play simply passes to X.
 */
export async function shiftBoardAction(
  id: string,
  direction: Direction,
  playerId: string,
): Promise<StoreResult> {
  return withRoomTx(id, (room) => {
    sweepSeats(room);

    if (isGameOver(room.board)) {
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

export async function resetGame(
  id: string,
  playerId: string,
): Promise<StoreResult> {
  return withRoomTx(id, (room) => {
    sweepSeats(room);
    if (room.seats.X !== playerId && room.seats.O !== playerId) {
      return { ok: false, error: "not-participant" };
    }
    room.board = EMPTY_BOARD.slice();
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
