import { describe, expect, it } from "vitest";
import {
  boardAfterActions,
  calculateWinner,
  chooseAiAction,
  DIRECTIONS,
  isBoardFull,
  shiftBoard,
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
  it("matches the ticket's worked example for a right shift", () => {
    // x o o        _ _ x
    // o x o  --->  _ o x   (collapse right)
    // o x _        _ o x
    const board: Board = ["X", "O", "O", "O", "X", "O", "O", "X", null];
    expect(shiftBoard(board, "right", "collapse")).toEqual([
      null, null, "X",
      null, "O", "X",
      null, "O", "X",
    ]);
  });

  it("slides every mark to the leading edge, not just one cell", () => {
    // A lone mark in the trailing corner travels the full width/height.
    const topLeft = emptyBoard();
    topLeft[0] = "O";
    expect(shiftBoard(topLeft, "right", "collapse")[2]).toBe("O");
    expect(shiftBoard(topLeft, "bottom", "collapse")[6]).toBe("O");
  });

  it("lets X plough through and remove O marks in its path", () => {
    // X O O on the top row, shifted right: X travels to the wall, removing both
    // O marks ahead of it on the way.
    const row: Board = ["X", "O", "O", null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      null,
      "X",
    ]);
  });

  it("blocks O behind an X (O cannot capture X)", () => {
    // O _ X shifted right: X is already at the wall, O stops next to it.
    const row: Board = ["O", null, "X", null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      "O",
      "X",
    ]);
  });

  it("stacks same-kind marks against the leading edge", () => {
    // O O _ shifted right: both O slide and stack at the right edge.
    const row: Board = ["O", "O", null, null, null, null, null, null, null];
    expect(shiftBoard(row, "right", "collapse").slice(0, 3)).toEqual([
      null,
      "O",
      "O",
    ]);
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
    // Collapse: X ploughs to the wall removing O, so only X survives at 2.
    expect(collapse[2]).toBe("X");
    expect(collapse.filter((c) => c === "O")).toHaveLength(0);
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
