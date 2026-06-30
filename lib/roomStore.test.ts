import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimSeat,
  countViewers,
  createRoom,
  getPlayerStats,
  getRoom,
  heartbeatViewer,
  leaveSeat,
  listCompletedGames,
  listRooms,
  makeMove,
  removeViewer,
  shiftBoardAction,
  toView,
} from "@/lib/roomStore";
import prisma from "@/lib/prisma";
import { setGameConfig } from "@/lib/gameConfig";
import { AI_SEAT, AUTO_RESET_MS } from "@/constants/game";
import type { Room } from "@/lib/roomTypes";

// These tests run against the throwaway local Postgres started by
// test/globalSetup.ts (never a real/Neon database; see test/testDb.ts). Each
// test starts from empty tables so the async, Prisma-backed store is exercised
// in isolation.

const PX = "player-x";
const PO = "player-o";

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "rooms", "completed_games", "room_participants"',
  );
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

describe("local same-device mode", () => {
  it("gives both seats to the one player who claims a local room", async () => {
    const created = await createRoom("local room", "local");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seats).toEqual({ X: PX, O: PX }); // same player holds both sides
  });

  it("lets the one seated player move for both X and O", async () => {
    const created = await createRoom("local room", "local");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "O", PX)).ok).toBe(true); // either side claims both

    expect((await makeMove(id, 0, PX)).ok).toBe(true); // X's turn
    expect((await makeMove(id, 3, PX)).ok).toBe(true); // O's turn, same player
    expect((await makeMove(id, 1, PX)).ok).toBe(true); // X again

    const room = await getRoom(id);
    expect(room?.board[0]).toBe("X");
    expect(room?.board[3]).toBe("O");
    expect(room?.board[1]).toBe("X");
    // No AI ever replies in a local room: only the human's three marks are down.
    expect(room?.actions).toHaveLength(3);
  });

  it("keeps both seats and per-seat scores stable across a reset (no swap)", async () => {
    const created = await createRoom("local room", "local");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);

    // The one player plays both sides to an X win on the top row.
    expect((await makeMove(id, 0, PX)).ok).toBe(true); // X
    expect((await makeMove(id, 3, PX)).ok).toBe(true); // O
    expect((await makeMove(id, 1, PX)).ok).toBe(true); // X
    expect((await makeMove(id, 4, PX)).ok).toBe(true); // O
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins top row
    const won = await getRoom(id);
    expect(won?.scores).toEqual({ X: 1, O: 0, draws: 0 });

    // Age the finished game past the reset delay, then heartbeat to heal it.
    await prisma.room.update({
      where: { id },
      data: { lastActivity: new Date(Date.now() - AUTO_RESET_MS - 1000) },
    });
    const room = await getRoom(id, PX); // the player's heartbeat heals it
    expect(room?.seats).toEqual({ X: PX, O: PX }); // seats never swap in local mode
    expect(room?.xIsNext).toBe(true); // fresh round, X opens
    expect(room?.actions).toHaveLength(0);
    expect(room?.scores).toEqual({ X: 1, O: 0, draws: 0 }); // X's win stayed on X
  });

  it("clears the round and scores when the sole player leaves", async () => {
    const created = await createRoom("local room", "local");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await leaveSeat(id, PX)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seats).toEqual({ X: null, O: null }); // both freed
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    expect(room?.scores).toEqual({ X: 0, O: 0, draws: 0 });
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

describe("getPlayerStats", () => {
  /** PX (X) wins the top row against PO in a fresh room. */
  async function playXWin(id: string): Promise<void> {
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true);
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins
  }

  /** PO (O) wins the middle row against PX in a fresh room. */
  async function playOWin(id: string): Promise<void> {
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 4, PO)).ok).toBe(true);
    expect((await makeMove(id, 8, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true); // O wins
  }

  /** A full board with no line: a draw between PX (X) and PO (O). */
  async function playDraw(id: string): Promise<void> {
    for (const [index, player] of [
      [0, PX], [1, PO], [2, PX], [4, PO], [3, PX],
      [5, PO], [7, PX], [6, PO], [8, PX],
    ] as const) {
      expect((await makeMove(id, index, player)).ok).toBe(true);
    }
  }

  it("returns an all-zero record for a player with no finished games", async () => {
    expect(await getPlayerStats(PX)).toEqual({ won: 0, lost: 0, drawn: 0 });
    expect(await getPlayerStats("")).toEqual({ won: 0, lost: 0, drawn: 0 });
  });

  it("tallies wins, losses, and draws per player across games", async () => {
    await playXWin((await seatedRoom()).id); // PX wins, PO loses
    await playOWin((await seatedRoom()).id); // PO wins, PX loses
    await playDraw((await seatedRoom()).id); // both draw

    // Each tally follows the person, not the X/O seat they happened to hold.
    expect(await getPlayerStats(PX)).toEqual({ won: 1, lost: 1, drawn: 1 });
    expect(await getPlayerStats(PO)).toEqual({ won: 1, lost: 1, drawn: 1 });
    // A player who took part in nothing has no record.
    expect(await getPlayerStats("stranger")).toEqual({
      won: 0,
      lost: 0,
      drawn: 0,
    });
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

describe("player display names", () => {
  it("stores a trimmed name per seat on claim and surfaces it", async () => {
    const created = await createRoom("named room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    expect((await claimSeat(id, "X", PX, "  Alice  ")).ok).toBe(true);
    expect((await claimSeat(id, "O", PO, "Bob")).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seatNames).toEqual({ X: "Alice", O: "Bob" });
  });

  it("treats a blank or whitespace-only name as no name", async () => {
    const created = await createRoom("nameless room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    expect((await claimSeat(id, "X", PX, "   ")).ok).toBe(true);
    expect((await claimSeat(id, "O", PO)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seatNames).toEqual({ X: null, O: null });
  });

  it("clips an overlong name to the 20-char limit", async () => {
    const created = await createRoom("long name room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    expect(
      (await claimSeat(id, "X", PX, "a".repeat(40))).ok,
    ).toBe(true);

    const room = await getRoom(id);
    expect(room?.seatNames.X).toBe("a".repeat(20));
  });

  it("lets a player update their name by re-claiming the seat", async () => {
    const created = await createRoom("rename room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    expect((await claimSeat(id, "X", PX, "Old")).ok).toBe(true);
    expect((await claimSeat(id, "X", PX, "New")).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seatNames.X).toBe("New");
  });

  it("carries each player's name across the seat swap on reset", async () => {
    const created = await createRoom("swap room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;
    expect((await claimSeat(id, "X", PX, "Alice")).ok).toBe(true);
    expect((await claimSeat(id, "O", PO, "Bob")).ok).toBe(true);

    // Alice (X) wins the top row, then age past the auto-reset delay.
    expect((await makeMove(id, 0, PX)).ok).toBe(true);
    expect((await makeMove(id, 3, PO)).ok).toBe(true);
    expect((await makeMove(id, 1, PX)).ok).toBe(true);
    expect((await makeMove(id, 5, PO)).ok).toBe(true);
    expect((await makeMove(id, 2, PX)).ok).toBe(true); // X wins
    await prisma.room.update({
      where: { id },
      data: { lastActivity: new Date(Date.now() - AUTO_RESET_MS - 1000) },
    });

    const room = await getRoom(id, PX); // heartbeat heals + swaps seats
    // Seats swapped (Alice now O, Bob now X) and each name followed its player.
    expect(room?.seats).toEqual({ X: PO, O: PX });
    expect(room?.seatNames).toEqual({ X: "Bob", O: "Alice" });
  });

  it("clears a seat's name when its player leaves", async () => {
    const created = await createRoom("leave room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;
    expect((await claimSeat(id, "X", PX, "Alice")).ok).toBe(true);
    expect((await claimSeat(id, "O", PO, "Bob")).ok).toBe(true);

    expect((await leaveSeat(id, PX)).ok).toBe(true);

    const room = await getRoom(id);
    expect(room?.seatNames).toEqual({ X: null, O: "Bob" });
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

describe("viewer presence counting", () => {
  it("counts distinct heartbeating viewers and is idempotent per viewer", async () => {
    const created = await createRoom("viewed room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    expect(await countViewers(id)).toBe(0);

    // Two viewers; the second heartbeat for the same viewer must not double-count.
    await heartbeatViewer(id, "viewer-a");
    await heartbeatViewer(id, "viewer-b");
    await heartbeatViewer(id, "viewer-a");
    expect(await countViewers(id)).toBe(2);
  });

  it("scopes the count to the room", async () => {
    const a = await createRoom("room a", "two-player");
    const b = await createRoom("room b", "two-player");
    if (!a.ok || !b.ok) throw new Error("room creation failed");

    await heartbeatViewer(a.room.id, "viewer-a");
    await heartbeatViewer(b.room.id, "viewer-b");
    await heartbeatViewer(b.room.id, "viewer-c");

    expect(await countViewers(a.room.id)).toBe(1);
    expect(await countViewers(b.room.id)).toBe(2);
  });

  it("excludes viewers whose heartbeat has expired past the TTL", async () => {
    const created = await createRoom("viewed room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    await heartbeatViewer(id, "stale");
    await heartbeatViewer(id, "fresh");

    // Age one viewer's heartbeat well past the 12s TTL directly in the database.
    await prisma.roomParticipant.update({
      where: { roomId_playerId: { roomId: id, playerId: "stale" } },
      data: { lastSeen: new Date(Date.now() - 60_000) },
    });

    // The count excludes the expired row without deleting it.
    expect(await countViewers(id)).toBe(1);
    const rows = await prisma.roomParticipant.findMany({ where: { roomId: id } });
    expect(rows.map((r) => r.playerId).sort()).toEqual(["fresh", "stale"]);
  });

  it("drops a viewer immediately on removeViewer", async () => {
    const created = await createRoom("viewed room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    await heartbeatViewer(id, "leaver");
    expect(await countViewers(id)).toBe(1);

    await removeViewer(id, "leaver");
    expect(await countViewers(id)).toBe(0);
    // Removing an absent viewer is a harmless no-op.
    await removeViewer(id, "leaver");
    expect(await countViewers(id)).toBe(0);
  });

  it("surfaces the count on the serialized view via toView", async () => {
    const created = await createRoom("viewed room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const { id } = created.room;

    await heartbeatViewer(id, "viewer-a");
    const room = await getRoom(id);
    if (!room) throw new Error("room not found");

    expect(toView(room).viewerCount).toBeUndefined();
    expect(toView(room, await countViewers(id)).viewerCount).toBe(1);
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

describe("X conditional shift", () => {
  // X's once-per-game shift only exists on boards larger than 3x3 and only once
  // the game is past turn 5 (the canXShift rule). These tests create games at
  // boardSize 5 (win run 5, so scattered placements never settle early) to
  // exercise that gate; the config row is reset afterwards so it never leaks.
  beforeEach(async () => {
    await setGameConfig({ boardSize: 5, winLength: 5 });
  });
  afterAll(async () => {
    await prisma.appConfig.deleteMany(); // restore the default 3x3 config
  });

  /** A seated 5x5 two-player room (X=PX, O=PO); returns its id. */
  async function seatedBigRoom(): Promise<string> {
    const created = await createRoom("big room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);
    expect((await claimSeat(id, "O", PO)).ok).toBe(true);
    return id;
  }

  it("rejects X's shift early, before the turn threshold", async () => {
    const id = await seatedBigRoom();
    // Fresh game: X is on turn, but the turn number (actions.length) is 0, so
    // the shift has not unlocked yet.
    expect(await shiftBoardAction(id, "left", PX)).toEqual({
      ok: false,
      error: "shift-unavailable",
    });
  });

  it("lets X shift once the game is past turn 5, consuming X's turn", async () => {
    const id = await seatedBigRoom();
    // Six scattered placements alternating X/O (no run of five), so it is X's
    // turn again with actions.length === 6 (> 5) and the shift is unlocked.
    const cells = [0, 2, 4, 10, 12, 14];
    const players = [PX, PO, PX, PO, PX, PO];
    for (let i = 0; i < cells.length; i++) {
      expect((await makeMove(id, cells[i], players[i])).ok).toBe(true);
    }
    let room = await getRoom(id);
    expect(room?.xIsNext).toBe(true);
    expect(room?.actions).toHaveLength(6);

    expect((await shiftBoardAction(id, "left", PX)).ok).toBe(true);

    room = await getRoom(id);
    expect(room?.xShiftUsed).toBe(true);
    expect(room?.xIsNext).toBe(false); // the shift was X's whole turn -> O next
    const last = room?.actions[room.actions.length - 1];
    expect(last).toMatchObject({ kind: "shift", mode: "classic" });
  });

  it("never lets X shift on a 3x3 board, even past turn 5", async () => {
    await setGameConfig({ boardSize: 3, winLength: 3 });
    const created = await createRoom("small room", "two-player");
    if (!created.ok) throw new Error("room creation failed");
    const id = created.room.id;
    expect((await claimSeat(id, "X", PX)).ok).toBe(true);
    expect((await claimSeat(id, "O", PO)).ok).toBe(true);

    // Six placements with no three-in-a-row, leaving it X's turn at turn 6.
    const cells = [0, 1, 5, 2, 7, 3];
    const players = [PX, PO, PX, PO, PX, PO];
    for (let i = 0; i < cells.length; i++) {
      expect((await makeMove(id, cells[i], players[i])).ok).toBe(true);
    }
    const room = await getRoom(id);
    expect(room?.xIsNext).toBe(true);
    // Turn threshold met, but a 3x3 board never grants X a shift.
    expect(await shiftBoardAction(id, "left", PX)).toEqual({
      ok: false,
      error: "shift-unavailable",
    });
  });
});
