import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimSeat,
  createRoom,
  getRoom,
  leaveSeat,
  listCompletedGames,
  listRooms,
  makeMove,
  shiftBoardAction,
  toView,
} from "@/lib/roomStore";
import prisma from "@/lib/prisma";
import { AI_SEAT, AUTO_RESET_MS } from "@/constants/game";
import type { Room } from "@/lib/roomTypes";

// These tests run against the throwaway local Postgres started by
// test/globalSetup.ts (never a real/Neon database; see test/testDb.ts). Each
// test starts from empty tables so the async, Prisma-backed store is exercised
// in isolation.

const PX = "player-x";
const PO = "player-o";

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "rooms", "completed_games"');
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A fresh two-player room with X and O seats claimed by PX/PO. */
async function seatedRoom(): Promise<Room> {
  const created = await createRoom("test room", "two-player");
  if (!created.ok) throw new Error("room creation failed");
  const id = created.room.id;
  expect((await claimSeat(id, "X", PX)).ok).toBe(true);
  expect((await claimSeat(id, "O", PO)).ok).toBe(true);
  const room = await getRoom(id);
  if (!room) throw new Error("room not found after creation");
  return room;
}

describe("makeMove turn and seat validation", () => {
  it("lets X take even-indexed actions and O odd ones", async () => {
    const { id } = await seatedRoom();

    expect((await makeMove(id, 0, PX)).ok).toBe(true); // action 0: X
    expect((await makeMove(id, 1, PO)).ok).toBe(true); // action 1: O
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // action 2: X

    const room = await getRoom(id);
    expect(room?.board[0]).toBe("X");
    expect(room?.board[1]).toBe("O");
    expect(room?.board[2]).toBe("X");
    expect(room?.actions).toHaveLength(3);
  });

  it("rejects a move made out of turn", async () => {
    const { id } = await seatedRoom();

    // It is X's turn; O cannot move yet.
    expect(await makeMove(id, 0, PO)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
    // Even X playing the wrong seat's id is rejected.
    expect(await makeMove(id, 0, "stranger")).toEqual({
      ok: false,
      error: "not-your-turn",
    });

    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    // Now it is O's turn; X cannot move.
    expect(await makeMove(id, 1, PX)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("rejects placing on an occupied cell", async () => {
    const { id } = await seatedRoom();
    expect((await makeMove(id, 4, PX)).ok).toBe(true); // X claims center
    // O's turn; the center is taken.
    expect(await makeMove(id, 4, PO)).toEqual({
      ok: false,
      error: "cell-taken",
    });
  });

  it("rejects an out-of-bounds index", async () => {
    const { id } = await seatedRoom();
    expect(await makeMove(id, 9, PX)).toEqual({
      ok: false,
      error: "invalid-index",
    });
    expect(await makeMove(id, -1, PX)).toEqual({
      ok: false,
      error: "invalid-index",
    });
  });
});

describe("shiftBoardAction validation", () => {
  it("rejects a shift on X's turn", async () => {
    const { id } = await seatedRoom();
    // Fresh room: it is X's turn, so O may not shift.
    expect(await shiftBoardAction(id, "top", PO)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("rejects a shift by anyone other than O on O's turn", async () => {
    const { id } = await seatedRoom();
    expect((await makeMove(id, 0, PX)).ok).toBe(true); // hand the turn to O
    expect(await shiftBoardAction(id, "top", PX)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("lets O shift on O's turn and then passes play back to X", async () => {
    const { id } = await seatedRoom();
    expect((await makeMove(id, 0, PX)).ok).toBe(true); // O's turn

    const result = await shiftBoardAction(id, "bottom", PO);
    expect(result.ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.oShiftUsed).toBe(true);
    expect(room?.xIsNext).toBe(true); // the shift used up O's whole turn
    // The shift was recorded in the action log after X's placement.
    expect(room?.actions.map((a) => a.kind)).toEqual(["place", "shift"]);
  });

  it("rejects a second shift once O's one-time shift is spent", async () => {
    const { id } = await seatedRoom();
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await shiftBoardAction(id, "bottom", PO)).ok).toBe(true); // first shift
    expect((await makeMove(id, 1, PX)).ok).toBe(true); // X plays, back to O

    expect(await shiftBoardAction(id, "top", PO)).toEqual({
      ok: false,
      error: "shift-used",
    });
  });

  // Locks in the exact availability/turn behaviour the room UI gates its shift
  // controls on (canShiftNow): O may shift only on O's turn, exactly once, the
  // shift consumes the turn, and it translates marks (pushing off the edge).
  it("makes the shift available only on O's turn, once, and translates the board", async () => {
    const { id } = await seatedRoom();

    // X's turn: the shift is not yet available to O.
    let room = await getRoom(id);
    expect(room?.xIsNext).toBe(true);
    expect(room?.oShiftUsed).toBe(false);
    expect(await shiftBoardAction(id, "left", PO)).toEqual({
      ok: false,
      error: "not-your-turn",
    });

    // X plays the top-left corner, handing the turn to O.
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    room = await getRoom(id);
    expect(room?.xIsNext).toBe(false); // now O's turn -> shift is available
    expect(room?.board[0]).toBe("X");

    // O shifts the grid left: every mark slides one cell toward the left edge,
    // and the X in column 0 is pushed off the board and removed.
    expect((await shiftBoardAction(id, "left", PO)).ok).toBe(true);
    room = await getRoom(id);
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    expect(room?.oShiftUsed).toBe(true);
    expect(room?.xIsNext).toBe(true); // the shift used up O's whole turn
  });
});

describe("AI seating and follow-up", () => {
  it("opens an AI room with both seats free until the human picks a side", async () => {
    const created = await createRoom("ai room", "ai");
    if (!created.ok) throw new Error("room creation failed");
    // Neither seat is pre-assigned; the human chooses on claim.
    expect(created.room.seats).toEqual({ X: null, O: null });
  });

  it("seats the AI opposite a human who plays X and replies as O", async () => {
    const created = await createRoom("ai room", "ai");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);

    const seated = await getRoom(id);
    expect(seated?.seats.O).toBe(AI_SEAT); // AI took the open seat
    expect(seated?.xIsNext).toBe(true); // human X opens, AI has not moved yet

    // X plays the center; the AI must reply within the same call.
    expect((await makeMove(id, 4, PX)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.xIsNext).toBe(true); // turn handed back to the human
    expect(room?.actions).toHaveLength(2); // X's placement + O's reply
    expect(room?.actions[1]?.kind).toBe("place");
    expect(room?.board[4]).toBe("X");
    expect(room?.board.filter((cell) => cell === "O")).toHaveLength(1);
  });

  it("seats the AI as X and opens the game when the human plays O", async () => {
    const created = await createRoom("ai room", "ai");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "O", PO)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seats.X).toBe(AI_SEAT); // AI took the open seat
    expect(room?.xIsNext).toBe(false); // AI X has already opened; O to move
    expect(room?.actions).toHaveLength(1); // the AI's opening placement
    expect(room?.board.filter((cell) => cell === "X")).toHaveLength(1);
  });

  it("frees the AI seat and resets when the human leaves, so a side is re-choosable", async () => {
    const created = await createRoom("ai room", "ai");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "O", PO)).ok).toBe(true);
    expect((await leaveSeat(id, PO)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seats).toEqual({ X: null, O: null });
    expect(room?.actions).toHaveLength(0);
    expect(room?.board.every((cell) => cell === null)).toBe(true);

    // The next player can now take the other side.
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);
    const after = await getRoom(id);
    expect(after?.seats.O).toBe(AI_SEAT);
  });
});

describe("scoring and completed-game archival on settle", () => {
  it("scores a win once and archives the finished game", async () => {
    const { id } = await seatedRoom();

    // X takes the top row 0,1,2 while O plays elsewhere.
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true);
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins

    const room = await getRoom(id);
    expect(room?.scores).toEqual({ X: 1, O: 0, draws: 0 });

    // The finished game is archived exactly once, with X as the winner, and is
    // listed to each of its two players.
    expect(await listCompletedGames(PX)).toHaveLength(1);
    const completed = await listCompletedGames(PO);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.winner).toBe("X");

    // No further moves once the game is over.
    expect(await makeMove(id, 6, PX)).toEqual({
      ok: false,
      error: "game-over",
    });
  });

  it("lists a completed game only to the players who took part in it", async () => {
    const { id } = await seatedRoom();

    // X wins the top row; the game is archived with PX and PO as participants.
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true);
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins

    // Both participants see it; an unrelated player and an empty id see nothing.
    expect(await listCompletedGames(PX)).toHaveLength(1);
    expect(await listCompletedGames(PO)).toHaveLength(1);
    expect(await listCompletedGames("stranger")).toHaveLength(0);
    expect(await listCompletedGames("")).toHaveLength(0);
  });

});

// The next-round reset is server-authoritative and lazy: any per-request
// transaction (a stream heartbeat read or a claim) heals a finished room once
// it has sat in its end state for AUTO_RESET_MS. No client timer is involved,
// so a room recovers even when every client has left. Aging `lastActivity` past
// the delay stands in for the wait, the same trick the TTL/reap tests use.
describe("lazy next-round reset", () => {
  /** Push the room's lastActivity past the auto-reset delay. */
  async function ageBeyondResetDelay(id: string): Promise<void> {
    await prisma.room.update({
      where: { id },
      data: { lastActivity: new Date(Date.now() - AUTO_RESET_MS - 1000) },
    });
  }

  /** Drive PX (X) to a top-row win so the round is finished and scored. */
  async function playXWin(id: string): Promise<void> {
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true);
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins
  }

  it("resets a finished two-player game via a heartbeat read after the delay", async () => {
    const { id } = await seatedRoom(); // PX in X, PO in O
    await playXWin(id);
    await ageBeyondResetDelay(id);

    // A heartbeat read (the per-second stream tick) heals the finished room.
    const room = await getRoom(id, PX);
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    expect(room?.actions).toHaveLength(0);
    expect(room?.xIsNext).toBe(true);
    // Seats swapped so the players alternate going first, scores following them.
    expect(room?.seats).toEqual({ X: PO, O: PX });
    expect(room?.scores).toEqual({ X: 0, O: 1, draws: 0 });
  });

  it("does not reset a game that just finished (delay not yet elapsed)", async () => {
    const { id } = await seatedRoom();
    await playXWin(id);

    // No aging: the finished board is still within the on-screen delay.
    const room = await getRoom(id, PX);
    expect(toView(room as Room).status).toBe("finished");
    expect(room?.board[0]).toBe("X");
    expect(room?.board[1]).toBe("X");
    expect(room?.board[2]).toBe("X");
    expect(room?.seats).toEqual({ X: PX, O: PO }); // no swap yet
  });

  it("resets an AI room and lets the AI open the new round as X", async () => {
    const created = await createRoom("ai room", "ai");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "O", PO)).ok).toBe(true); // human O, AI holds X

    // Set a finished board directly (X wins the top row) rather than beating the
    // AI's minimax, then age it past the delay.
    await prisma.room.update({
      where: { id },
      data: {
        board: ["X", "X", "X", null, null, null, null, null, null],
        actions: [
          { kind: "place", index: 0 },
          { kind: "place", index: 3 },
          { kind: "place", index: 1 },
          { kind: "place", index: 4 },
          { kind: "place", index: 2 },
        ],
        xIsNext: false,
        lastActivity: new Date(Date.now() - AUTO_RESET_MS - 1000),
      },
    });

    const room = await getRoom(id, PO); // human O's heartbeat heals it
    // No seat swap in AI mode: the human keeps O, the AI keeps X.
    expect(room?.seats).toEqual({ X: AI_SEAT, O: PO });
    // The AI, holding X, has opened the fresh game with exactly one mark.
    expect(room?.actions).toHaveLength(1);
    expect(room?.xIsNext).toBe(false); // AI X moved; human O is up
    expect(room?.board.filter((cell) => cell === "X")).toHaveLength(1);
  });

  it("heals a stuck room when a new player rejoins after both leave (symptom 1)", async () => {
    const { id } = await seatedRoom();
    await playXWin(id);
    expect((await leaveSeat(id, PX)).ok).toBe(true);
    expect((await leaveSeat(id, PO)).ok).toBe(true);
    await ageBeyondResetDelay(id);

    // A newcomer claiming a seat resets the stale end state in the same call.
    expect((await claimSeat(id, "X", "newcomer")).ok).toBe(true);
    const room = await getRoom(id);
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    // The guarded swap leaves the lone newcomer on the seat they claimed.
    expect(room?.seats).toEqual({ X: "newcomer", O: null });
  });

  it("heals a stuck room via a spectator read (symptom 1)", async () => {
    const { id } = await seatedRoom();
    await playXWin(id);
    expect((await leaveSeat(id, PX)).ok).toBe(true);
    expect((await leaveSeat(id, PO)).ok).toBe(true);
    await ageBeyondResetDelay(id);

    // A non-seated onlooker's heartbeat still drives the reset.
    const room = await getRoom(id, "spectator-no-seat");
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    expect(room?.actions).toHaveLength(0);
  });

  it("resets exactly once across back-to-back heartbeats (idempotent)", async () => {
    const { id } = await seatedRoom();
    await playXWin(id);
    await ageBeyondResetDelay(id);

    const first = await getRoom(id, PX);
    expect(first?.seats).toEqual({ X: PO, O: PX }); // swapped once
    expect(first?.scores).toEqual({ X: 0, O: 1, draws: 0 });

    // A second heartbeat must not swap again or rescore: the room is no longer
    // game-over, so the guard is a no-op.
    const second = await getRoom(id, PX);
    expect(second?.seats).toEqual({ X: PO, O: PX });
    expect(second?.scores).toEqual({ X: 0, O: 1, draws: 0 });
  });
});

describe("seat TTL sweeping", () => {
  it("auto-releases a seat whose heartbeat has expired", async () => {
    const { id } = await seatedRoom();

    // Age O's heartbeat well past the 30s TTL directly in the database.
    const stale = new Date(Date.now() - 60_000);
    await prisma.room.update({
      where: { id },
      data: { seatSeenO: stale },
    });

    // The next read sweeps the expired seat.
    const room = await getRoom(id);
    expect(room?.seats.O).toBeNull();

    // A different player can now take the freed seat.
    expect((await claimSeat(id, "O", "player-o2")).ok).toBe(true);
    const after = await getRoom(id);
    expect(after?.seats.O).toBe("player-o2");
  });

  it("refreshes and persists a still-valid seat's heartbeat", async () => {
    const { id } = await seatedRoom();

    // Age O's heartbeat, but keep it within the 30s TTL (not yet expired). A
    // heartbeat arriving before expiry bumps seatSeen and keeps the seat.
    const aged = new Date(Date.now() - 20_000);
    await prisma.room.update({ where: { id }, data: { seatSeenO: aged } });

    const room = await getRoom(id, PO); // heartbeat for PO
    expect(room?.seats.O).toBe(PO); // still held, not swept

    // The bump is persisted under the room lock: the stored heartbeat is now
    // fresh, not the aged value.
    const row = await prisma.room.findUniqueOrThrow({ where: { id } });
    expect(row.seatSeenO?.getTime()).toBeGreaterThan(aged.getTime());
  });
});

describe("idle room reaping", () => {
  it("drops rooms idle past the window on list", async () => {
    const fresh = await createRoom("fresh", "two-player");
    const stale = await createRoom("stale", "two-player");
    if (!fresh.ok || !stale.ok) throw new Error("room creation failed");

    // Push the stale room's activity 7 hours into the past (window is 6h).
    await prisma.room.update({
      where: { id: stale.room.id },
      data: { lastActivity: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    });

    const rooms = await listRooms();
    const ids = rooms.map((r) => r.id);
    expect(ids).toContain(fresh.room.id);
    expect(ids).not.toContain(stale.room.id);
    // The reap is a real delete, not just a filtered view.
    expect(await getRoom(stale.room.id)).toBeNull();
  });
});
