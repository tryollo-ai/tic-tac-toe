import { describe, expect, it } from "vitest";
import { cellCenter, winningLineCoords } from "@/utils/winningLineGeometry";

const SIXTH = 100 / 6; // center of an edge cell on a 3-column board
const HALF = 50; // center of the middle cell/row

describe("cellCenter", () => {
  it("places each cell center at (col + 0.5) / 3 and (row + 0.5) / 3", () => {
    expect(cellCenter(0)).toEqual({ x: SIXTH, y: SIXTH });
    expect(cellCenter(4)).toEqual({ x: HALF, y: HALF });
    expect(cellCenter(8)).toEqual({ x: 5 * SIXTH, y: 5 * SIXTH });
  });
});

describe("winningLineCoords", () => {
  it("spans the top row horizontally", () => {
    expect(winningLineCoords([0, 1, 2])).toEqual({
      x1: SIXTH,
      y1: SIXTH,
      x2: 5 * SIXTH,
      y2: SIXTH,
    });
  });

  it("spans the left column vertically", () => {
    expect(winningLineCoords([0, 3, 6])).toEqual({
      x1: SIXTH,
      y1: SIXTH,
      x2: SIXTH,
      y2: 5 * SIXTH,
    });
  });

  it("spans the main diagonal (top-left to bottom-right)", () => {
    expect(winningLineCoords([0, 4, 8])).toEqual({
      x1: SIXTH,
      y1: SIXTH,
      x2: 5 * SIXTH,
      y2: 5 * SIXTH,
    });
  });

  it("spans the anti-diagonal (top-right to bottom-left)", () => {
    expect(winningLineCoords([2, 4, 6])).toEqual({
      x1: 5 * SIXTH,
      y1: SIXTH,
      x2: SIXTH,
      y2: 5 * SIXTH,
    });
  });
});
