import { describe, expect, it } from "vitest";
import {
  claimSeat,
  createRoom,
  getRoom,
  makeMove,
  shiftBoardAction,
} from "@/lib/roomStore";
import type { Room } from "@/lib/roomTypes";

const PX = "player-x";
const PO = "player-o";

/** A fresh two-player room with X and O seats claimed by PX/PO. */
function seatedRoom(): Room {
  const created = createRoom("test room", "two-player");
  if (!created.ok) throw new Error("room creation failed");
  const id = created.room.id;
  expect(claimSeat(id, "X", PX).ok).toBe(true);
  expect(claimSeat(id, "O", PO).ok).toBe(true);
  const room = getRoom(id);
  if (!room) throw new Error("room not found after creation");
  return room;
}

describe("makeMove turn and seat validation", () => {
  it("lets X take even-indexed actions and O odd ones", () => {
    const { id } = seatedRoom();

    expect(makeMove(id, 0, PX).ok).toBe(true); // action 0: X
    expect(makeMove(id, 1, PO).ok).toBe(true); // action 1: O
    expect(makeMove(id, 2, PX).ok).toBe(true); // action 2: X

    const room = getRoom(id);
    expect(room?.board[0]).toBe("X");
    expect(room?.board[1]).toBe("O");
    expect(room?.board[2]).toBe("X");
    expect(room?.actions).toHaveLength(3);
  });

  it("rejects a move made out of turn", () => {
    const { id } = seatedRoom();

    // It is X's turn; O cannot move yet.
    expect(makeMove(id, 0, PO)).toEqual({ ok: false, error: "not-your-turn" });
    // Even X playing the wrong seat's id is rejected.
    expect(makeMove(id, 0, "stranger")).toEqual({
      ok: false,
      error: "not-your-turn",
    });

    expect(makeMove(id, 0, PX).ok).toBe(true);
    // Now it is O's turn; X cannot move.
    expect(makeMove(id, 1, PX)).toEqual({ ok: false, error: "not-your-turn" });
  });

  it("rejects placing on an occupied cell", () => {
    const { id } = seatedRoom();
    expect(makeMove(id, 4, PX).ok).toBe(true); // X claims center
    // O's turn; the center is taken.
    expect(makeMove(id, 4, PO)).toEqual({ ok: false, error: "cell-taken" });
  });

  it("rejects an out-of-bounds index", () => {
    const { id } = seatedRoom();
    expect(makeMove(id, 9, PX)).toEqual({ ok: false, error: "invalid-index" });
    expect(makeMove(id, -1, PX)).toEqual({ ok: false, error: "invalid-index" });
  });
});

describe("shiftBoardAction validation", () => {
  it("rejects a shift on X's turn", () => {
    const { id } = seatedRoom();
    // Fresh room: it is X's turn, so O may not shift.
    expect(shiftBoardAction(id, "top", PO)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("rejects a shift by anyone other than O on O's turn", () => {
    const { id } = seatedRoom();
    expect(makeMove(id, 0, PX).ok).toBe(true); // hand the turn to O
    expect(shiftBoardAction(id, "top", PX)).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("lets O shift on O's turn and then passes play back to X", () => {
    const { id } = seatedRoom();
    expect(makeMove(id, 0, PX).ok).toBe(true); // O's turn

    const result = shiftBoardAction(id, "bottom", PO);
    expect(result.ok).toBe(true);

    const room = getRoom(id);
    expect(room?.oShiftUsed).toBe(true);
    expect(room?.xIsNext).toBe(true); // the shift used up O's whole turn
    // The shift was recorded in the action log after X's placement.
    expect(room?.actions.map((a) => a.kind)).toEqual(["place", "shift"]);
  });

  it("rejects a second shift once O's one-time shift is spent", () => {
    const { id } = seatedRoom();
    expect(makeMove(id, 0, PX).ok).toBe(true);
    expect(shiftBoardAction(id, "bottom", PO).ok).toBe(true); // first shift
    expect(makeMove(id, 1, PX).ok).toBe(true); // X plays, back to O

    expect(shiftBoardAction(id, "top", PO)).toEqual({
      ok: false,
      error: "shift-used",
    });
  });

  // Locks in the exact availability/turn behaviour the room UI gates its shift
  // controls on (canShiftNow): O may shift only on O's turn, exactly once, the
  // shift consumes the turn, and it translates marks (pushing off the edge).
  it("makes the shift available only on O's turn, once, and translates the board", () => {
    const { id } = seatedRoom();

    // X's turn: the shift is not yet available to O.
    let room = getRoom(id);
    expect(room?.xIsNext).toBe(true);
    expect(room?.oShiftUsed).toBe(false);
    expect(shiftBoardAction(id, "left", PO)).toEqual({
      ok: false,
      error: "not-your-turn",
    });

    // X plays the top-left corner, handing the turn to O.
    expect(makeMove(id, 0, PX).ok).toBe(true);
    room = getRoom(id);
    expect(room?.xIsNext).toBe(false); // now O's turn -> shift is available
    expect(room?.board[0]).toBe("X");

    // O shifts the grid left: every mark slides one cell toward the left edge,
    // and the X in column 0 is pushed off the board and removed.
    expect(shiftBoardAction(id, "left", PO).ok).toBe(true);
    room = getRoom(id);
    expect(room?.board.every((cell) => cell === null)).toBe(true);
    expect(room?.oShiftUsed).toBe(true);
    expect(room?.xIsNext).toBe(true); // the shift used up O's whole turn
  });
});
