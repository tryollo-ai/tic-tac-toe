import { describe, expect, it } from "vitest";
import {
  actionSentence,
  cellName,
  describeAction,
} from "@/utils/historyLabels";

describe("cellName", () => {
  it("names every cell of the 3×3 board", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => cellName(i))).toEqual([
      "top-left",
      "top",
      "top-right",
      "left",
      "center",
      "right",
      "bottom-left",
      "bottom",
      "bottom-right",
    ]);
  });

  it("falls back to a 1-based cell number on a non-3×3 board", () => {
    expect(cellName(0, 4)).toBe("cell 1");
    expect(cellName(9, 4)).toBe("cell 10");
  });
});

describe("describeAction", () => {
  it("assigns X to even indices and O to odd indices", () => {
    expect(describeAction({ kind: "place", index: 4 }, 0).player).toBe("X");
    expect(describeAction({ kind: "place", index: 0 }, 1).player).toBe("O");
    expect(describeAction({ kind: "place", index: 8 }, 2).player).toBe("X");
  });

  it("summarizes a placement with its named cell", () => {
    expect(describeAction({ kind: "place", index: 4 }, 0)).toEqual({
      player: "X",
      move: "center",
    });
    expect(describeAction({ kind: "place", index: 0 }, 1)).toEqual({
      player: "O",
      move: "top-left",
    });
  });

  it("summarizes a trick with its plain-word direction", () => {
    expect(describeAction({ kind: "shift", dir: "top" }, 1)).toEqual({
      player: "O",
      move: "trick up",
    });
    expect(describeAction({ kind: "shift", dir: "bottom" }, 1).move).toBe(
      "trick down",
    );
    expect(describeAction({ kind: "shift", dir: "left" }, 1).move).toBe(
      "trick left",
    );
    expect(describeAction({ kind: "shift", dir: "right" }, 1).move).toBe(
      "trick right",
    );
  });
});

describe("actionSentence", () => {
  it("narrates a placement with the marking player and named cell", () => {
    expect(actionSentence({ kind: "place", index: 4 }, 0)).toBe(
      "X marked center",
    );
    expect(actionSentence({ kind: "place", index: 0 }, 1)).toBe(
      "O marked top-left",
    );
  });

  it("spells out O's grid trick with its plain-word direction", () => {
    expect(actionSentence({ kind: "shift", dir: "top" }, 1)).toBe(
      "O tricked the grid up",
    );
    expect(actionSentence({ kind: "shift", dir: "bottom" }, 1)).toBe(
      "O tricked the grid down",
    );
  });
});
