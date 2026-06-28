import { describe, expect, it } from "vitest";
import {
  boardAfterActions,
  boardSize,
  calculateWinner,
  chooseAiAction,
  DIRECTIONS,
  isBoardFull,
  shiftBoard,
  shiftPlan,
  winningLines,
  type Board,
  type Cell,
  type GameAction,
  type Player,
} from "./gameLogic";
import { INITIAL_SIZE } from "@/constants/game";

const CELLS = INITIAL_SIZE * INITIAL_SIZE;

/** The eight winning triples, mirroring the spec in gameLogic.ts. */
const WINNING_LINES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function emptyBoard(): Board {
  return Array<Cell>(CELLS).fill(null);
}

/** A board with `player` placed on exactly the three cells of `line`. */
function boardWithLine(line: readonly number[], player: Player): Board {
  const board = emptyBoard();
  for (const i of line) board[i] = player;
  return board;
}

describe("calculateWinner", () => {
  for (const player of ["X", "O"] as const) {
    for (const line of WINNING_LINES) {
      it(`detects ${player} winning on line ${line.join("-")}`, () => {
        const result = calculateWinner(boardWithLine(line, player));
        expect(result).not.toBeNull();
        expect(result?.winner).toBe(player);
        expect(result?.line).toEqual(line);
      });
    }
  }

  it("reports a full board with no line as a draw (no winner)", () => {
    // X O X / X O O / O X X - full, yet no three-in-a-row.
    const board: Board = ["X", "O", "X", "X", "O", "O", "O", "X", "X"];
    expect(isBoardFull(board)).toBe(true);
    expect(calculateWinner(board)).toBeNull();
  });

  it("reports an in-progress board as neither win nor full", () => {
    const board: Board = ["X", "O", null, null, "X", null, null, null, "O"];
    expect(calculateWinner(board)).toBeNull();
    expect(isBoardFull(board)).toBe(false);
  });

  it("does not count a line with mixed marks as a win", () => {
    const board = emptyBoard();
    board[0] = "X";
    board[1] = "O";
    board[2] = "X";
    expect(calculateWinner(board)).toBeNull();
  });

  it("does not count a line with an empty cell as a win", () => {
    const board = emptyBoard();
    board[0] = "X";
    board[1] = "X";
    board[2] = null;
    expect(calculateWinner(board)).toBeNull();
  });
});

describe("shiftBoard", () => {
  it("translates a center mark one cell in each direction", () => {
    const center = emptyBoard();
    center[4] = "X"; // row 1, col 1
    expect(shiftBoard(center, "top")[1]).toBe("X");
    expect(shiftBoard(center, "bottom")[7]).toBe("X");
    expect(shiftBoard(center, "left")[3]).toBe("X");
    expect(shiftBoard(center, "right")[5]).toBe("X");
  });

  it("removes marks pushed off the leading edge", () => {
    const topRow = emptyBoard();
    topRow[1] = "X"; // on the top edge
    expect(shiftBoard(topRow, "top").every((c) => c === null)).toBe(true);

    const rightCol = emptyBoard();
    rightCol[5] = "O"; // on the right edge
    expect(shiftBoard(rightCol, "right").every((c) => c === null)).toBe(true);
  });

  it("translates several marks together and drops only those riding off", () => {
    // X . O / . X . / O . X  -> shift down by one row.
    const board: Board = ["X", null, "O", null, "X", null, "O", null, "X"];
    const shifted = shiftBoard(board, "bottom");
    // Bottom row (6,7,8) rides off; everything else moves down one row.
    expect(shifted).toEqual([
      null,
      null,
      null,
      "X",
      null,
      "O",
      null,
      "X",
      null,
    ]);
  });

  it("does not mutate the input board", () => {
    const board = emptyBoard();
    board[4] = "X";
    const snapshot = board.slice();
    shiftBoard(board, "left");
    expect(board).toEqual(snapshot);
  });

  it("never creates a new three-in-a-row (translate-only invariant)", () => {
    // Exhaustively check every possible 3x3 board: if it has no winner, no
    // shift in any direction can produce one. Shifting is rigid translation,
    // so a winning line after a shift must have already existed before it.
    const total = 3 ** CELLS;
    const symbols: Cell[] = [null, "X", "O"];
    for (let n = 0; n < total; n++) {
      const board: Board = [];
      let code = n;
      for (let i = 0; i < CELLS; i++) {
        board.push(symbols[code % 3]);
        code = Math.floor(code / 3);
      }
      if (calculateWinner(board) !== null) continue;
      for (const dir of DIRECTIONS) {
        expect(calculateWinner(shiftBoard(board, dir))).toBeNull();
      }
    }
  });
});

describe("shiftBoard collapse mode", () => {
  it("slides a line in to fill an empty edge without losing a mark", () => {
    // x x _        _ x x
    // _ o _  --->  _ _ o   (collapse right): the empty edge pulls each row in by
    // _ _ _        _ _ _   one; no mark sits on an edge, so none fall off.
    const board: Board = ["X", "X", null, null, "O", null, null, null, null];
    expect(shiftBoard(board, "right", "collapse")).toEqual([
      null, "X", "X",
      null, null, "O",
      null, null, null,
    ]);
  });

  it("matches the worked example for a left shift", () => {
    // x x o        o _ _
    // _ o _  --->  o _ _   (collapse left): row 0 sheds its leading XX and lands
    // x _ _        _ _ _   O; the middle O slides to the wall; the lone X drops.
    const board: Board = ["X", "X", "O", null, "O", null, "X", null, null];
    expect(shiftBoard(board, "left", "collapse")).toEqual([
      "O", null, null,
      "O", null, null,
      null, null, null,
    ]);
  });

  it("pulls a lone mark across empty space to the leading edge", () => {
    // A lone mark in the trailing corner travels the full width/height because
    // the leading edge is empty all the way to it.
    const topLeft = emptyBoard();
    topLeft[0] = "O";
    expect(shiftBoard(topLeft, "right", "collapse")[2]).toBe("O");
    expect(shiftBoard(topLeft, "bottom", "collapse")[6]).toBe("O");
  });

  it("sheds the leading run matching the edge and settles the next mark", () => {
    // O X X shifted right: the two X (matching the X on the edge) fall off and
    // the O slides to the wall.
    const row: Board = ["O", "X", "X", null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      null,
      "O",
    ]);
  });

  it("drops a lone mark sitting on the leading edge", () => {
    // O _ X shifted right: the edge X falls off and the O slides up one cell.
    const row: Board = ["O", null, "X", null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      "O",
      null,
    ]);
  });

  it("shifts a line that is uniformly the edge value entirely off", () => {
    // X X X shifted right: the edge stays X at every step, so the line keeps
    // shifting until all three have fallen off.
    const row: Board = ["X", "X", "X", null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("can complete a line by sliding marks to the edge", () => {
    // Three X down column 0, shifted right, all land in column 2 (empty edges).
    const board: Board = ["X", null, null, "X", null, null, "X", null, null];
    const out = shiftBoard(board, "right", "collapse");
    expect([out[2], out[5], out[8]]).toEqual(["X", "X", "X"]);
  });

  it("does not mutate the input board", () => {
    const board: Board = ["X", "O", "O", "O", "X", "O", "O", "X", null];
    const snapshot = board.slice();
    shiftBoard(board, "right", "collapse");
    expect(board).toEqual(snapshot);
  });

  it("defaults to the classic single-cell translation", () => {
    const board = emptyBoard();
    board[4] = "X";
    // No mode argument == classic: the center mark moves exactly one cell.
    expect(shiftBoard(board, "right")[5]).toBe("X");
    expect(shiftBoard(board, "right")[2]).toBeNull();
  });
});

describe("shiftPlan", () => {
  const cell = (row: number, col: number) => ({ row, col });

  it("maps the worked left-shift example to per-mark motion", () => {
    // x x o        o _ _
    // _ o _  --->  o _ _   (collapse left): the two X on row 0 and the lone X on
    // x _ _        _ _ _   row 2 are swept off the left edge; the O's settle.
    const board: Board = ["X", "X", "O", null, "O", null, "X", null, null];
    const plan = shiftPlan(board, "left", "collapse");

    // The settling marks are the O's, landing in column 0.
    const settles = plan.filter((m) => !m.departs);
    expect(settles).toContainEqual({
      player: "O",
      from: cell(0, 2),
      to: cell(0, 0),
      departs: false,
    });
    expect(settles).toContainEqual({
      player: "O",
      from: cell(1, 1),
      to: cell(1, 0),
      departs: false,
    });

    // The swept marks are all X, sent off the left edge (negative column).
    const departs = plan.filter((m) => m.departs);
    expect(departs.map((m) => m.player)).toEqual(["X", "X", "X"]);
    expect(departs.every((m) => m.to.col < 0)).toBe(true);
  });

  it("sweeps a line that is uniformly the edge value entirely off", () => {
    // O O O shifted left: the edge stays O at every step, so all three sweep off.
    const row: Board = ["O", "O", "O", null, null, null, null, null, null];
    const top = shiftPlan(row, "left", "collapse").slice(0, 3);
    expect(top.every((m) => m.departs)).toBe(true);
    expect(top.map((m) => m.player)).toEqual(["O", "O", "O"]);
  });

  it("steps every mark one cell for a classic shift, flagging edge departures", () => {
    // X at the right edge departs; X in the center steps one cell right.
    const board: Board = [null, null, "X", null, "X", null, null, null, null];
    const plan = shiftPlan(board, "right", "classic");
    expect(plan).toEqual([
      { player: "X", from: cell(0, 2), to: cell(0, 3), departs: true },
      { player: "X", from: cell(1, 1), to: cell(1, 2), departs: false },
    ]);
  });
});

describe("boardAfterActions", () => {
  const actions: GameAction[] = [
    { kind: "place", index: 0 }, // 0: X
    { kind: "place", index: 4 }, // 1: O
    { kind: "place", index: 1 }, // 2: X
    { kind: "shift", dir: "bottom" }, // 3: O shifts the whole grid down
    { kind: "place", index: 2 }, // 4: X
  ];

  it("replays each shift with the mode it was recorded with", () => {
    // Same prefix, two shift modes: the rebuilt board must differ accordingly.
    const place: GameAction[] = [
      { kind: "place", index: 0 }, // X top-left
      { kind: "place", index: 1 }, // O top-middle
    ];
    const classic = boardAfterActions(
      [...place, { kind: "shift", dir: "right", mode: "classic" }],
      3,
    );
    const collapse = boardAfterActions(
      [...place, { kind: "shift", dir: "right", mode: "collapse" }],
      3,
    );
    // Classic: X 0->1, O 1->2 (one cell each).
    expect(classic[1]).toBe("X");
    expect(classic[2]).toBe("O");
    // Collapse: the row slides right by its leading gap, so O lands at the wall
    // and X survives one cell behind it - nothing is swept off.
    expect(collapse[2]).toBe("O");
    expect(collapse[1]).toBe("X");
  });

  it("returns an empty board for a count of 0", () => {
    expect(boardAfterActions(actions, 0)).toEqual(emptyBoard());
  });

  it("rebuilds the board after a prefix of placements (X even, O odd)", () => {
    const board = boardAfterActions(actions, 3);
    const expected = emptyBoard();
    expected[0] = "X";
    expected[4] = "O";
    expected[1] = "X";
    expect(board).toEqual(expected);
  });

  it("applies a shift action while replaying", () => {
    // After the 4th action (the shift), the marks at 0,1,4 slide down a row to
    // 3,4,7; nothing rides off the bottom edge here.
    const board = boardAfterActions(actions, 4);
    const expected = emptyBoard();
    expected[3] = "X";
    expected[4] = "X";
    expected[7] = "O";
    expect(board).toEqual(expected);
  });

  it("clamps a count beyond the log to a full replay", () => {
    expect(boardAfterActions(actions, 99)).toEqual(
      boardAfterActions(actions, actions.length),
    );
  });

  it("never returns a board that completes a line via a shift", () => {
    // The shift at action index 3 only translates the existing marks, so the
    // replayed board still has no winner immediately after it.
    expect(calculateWinner(boardAfterActions(actions, 4))).toBeNull();
  });
});

describe("chooseAiAction", () => {
  // Shorthand board builder: "X" / "O" / "." per cell, left to right.
  const b = (spec: string): Board =>
    spec
      .replace(/\s+/g, "")
      .split("")
      .map((c) => (c === "." ? null : (c as Player)));

  it("returns null only when the board is full", () => {
    expect(chooseAiAction(b("XOXOXOXOX"), "O", true)).toBeNull();
  });

  it("plays a placement for the AI as X (X never has the shift)", () => {
    // The AI can hold either seat now; as X it opens with a placement.
    const action = chooseAiAction(b("........."), "X", false);
    expect(action?.kind).toBe("place");
  });

  it("blocks a single opponent threat by placing, sparing its shift", () => {
    // X threatens the top row at cell 2; O can simply block by placing there,
    // so it must not squander its one-time shift on a threat a placement covers.
    expect(chooseAiAction(b("XX. .O. ..."), "O", true)).toEqual({
      kind: "place",
      index: 2,
    });
  });

  it("spends its shift to scatter an opponent fork no placement can block", () => {
    // X has a double threat (rows {0,1,2} and column {0,3,6}); placing blocks
    // only one, so the AI shifts to break the fork instead.
    const action = chooseAiAction(b("XX. X.. ..O"), "O", true);
    expect(action?.kind).toBe("shift");
  });

  it("never shifts when the shift is unavailable, even facing a fork", () => {
    const action = chooseAiAction(b("XX. X.. ..O"), "O", false);
    expect(action?.kind).toBe("place");
  });
});

// --- Configurable board size and win length --------------------------------

/** Build an N×N board from a string of "X"/"O"/"." (whitespace ignored), where
 *  N is inferred as the square root of the cell count. */
function nBoard(spec: string): Board {
  return spec
    .replace(/\s+/g, "")
    .split("")
    .map((c) => (c === "." ? null : (c as Player)));
}

describe("winningLines", () => {
  it("yields the classic eight lines for a 3×3 board, run 3", () => {
    expect(winningLines(3, 3)).toHaveLength(8);
  });

  it("yields 10 lines for a 4×4 board, run 4 (4 rows + 4 cols + 2 diagonals)", () => {
    expect(winningLines(4, 4)).toHaveLength(10);
  });

  it("yields every run-3 placement on a 4×4 board (24 lines)", () => {
    // rows 4*2 + cols 4*2 + each diagonal (4-2)^2 * 2 = 8 + 8 + 8.
    expect(winningLines(4, 3)).toHaveLength(24);
  });

  it("makes each line exactly the run length, ordered along the line", () => {
    for (const line of winningLines(5, 4)) {
      expect(line).toHaveLength(4);
    }
  });
});

describe("calculateWinner with a configurable win length", () => {
  it("detects a full run-4 row on a 4×4 board", () => {
    const result = calculateWinner(nBoard("XXXX OOO. .... ...."), 4);
    expect(result?.winner).toBe("X");
    expect(result?.line).toEqual([0, 1, 2, 3]);
  });

  it("detects a run-4 column and diagonal", () => {
    expect(calculateWinner(nBoard("X... X... X... X..."), 4)?.line).toEqual([
      0, 4, 8, 12,
    ]);
    expect(calculateWinner(nBoard("O... .O.. ..O. ...O"), 4)?.winner).toBe("O");
  });

  it("does not count three in a row when the win length is four", () => {
    expect(calculateWinner(nBoard("XXX. .... .... ...."), 4)).toBeNull();
  });

  it("counts the same three in a row when the win length is three", () => {
    expect(calculateWinner(nBoard("XXX. .... .... ...."), 3)?.winner).toBe("X");
  });

  it("derives the board size from the cell count", () => {
    expect(boardSize(nBoard("X... .... .... ...."))).toBe(4);
  });
});

describe("shiftBoard on a larger board", () => {
  it("classic shift right moves marks one cell and drops the leading edge", () => {
    const shifted = shiftBoard(nBoard("X..O .... .... ...."), "right", "classic");
    expect(shifted[1]).toBe("X"); // X slid one cell right
    expect(shifted.includes("O")).toBe(false); // O rode off the right edge
  });
});

describe("chooseAiAction on a larger board", () => {
  it("completes its own run-3 line on a 4×4 board", () => {
    const action = chooseAiAction(
      nBoard("XX.. .... .... ...."),
      "X",
      false,
      "classic",
      3,
    );
    expect(action).toEqual({ kind: "place", index: 2 });
  });

  it("blocks the opponent's immediate run-3 threat on a 4×4 board", () => {
    const action = chooseAiAction(
      nBoard("OO.. X... .... ...."),
      "X",
      false,
      "classic",
      3,
    );
    expect(action).toEqual({ kind: "place", index: 2 });
  });

  it("returns a bounded placement on a large, mostly-empty board", () => {
    const big = Array<Cell>(100).fill(null);
    big[44] = "X";
    big[45] = "X";
    big[55] = "O";
    const action = chooseAiAction(big, "X", false, "classic", 5);
    expect(action?.kind).toBe("place");
  });
});
