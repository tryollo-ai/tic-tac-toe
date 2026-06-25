import { describe, expect, it } from "vitest";
import {
  cellCenter,
  winningLineCoords,
  type WinningLineCoords,
} from "@/utils/winningLineGeometry";

const SIXTH = 100 / 6; // center of an edge cell on a 3-column board
const HALF = 50; // center of the middle cell/row

// Endpoints are pushed 0.7 of a half-cell (100/6) past each end cell's center
// toward its outer edge, i.e. a 0.7 * 100/6 ≈ 11.67 shift. So an edge cell's
// endpoint moves from 100/6 to either 5 (toward the near edge) or, mirrored at
// the far end, to 95.
const NEAR = 5; // edge-cell endpoint pushed toward the near edge
const FAR = 95; // the opposite end

function expectCoords(actual: WinningLineCoords, expected: WinningLineCoords) {
  expect(actual.x1).toBeCloseTo(expected.x1, 6);
  expect(actual.y1).toBeCloseTo(expected.y1, 6);
  expect(actual.x2).toBeCloseTo(expected.x2, 6);
  expect(actual.y2).toBeCloseTo(expected.y2, 6);
}

describe("cellCenter", () => {
  it("places each cell center at (col + 0.5) / 3 and (row + 0.5) / 3", () => {
    expect(cellCenter(0)).toEqual({ x: SIXTH, y: SIXTH });
    expect(cellCenter(4)).toEqual({ x: HALF, y: HALF });
    expect(cellCenter(8)).toEqual({ x: 5 * SIXTH, y: 5 * SIXTH });
  });
});

describe("winningLineCoords", () => {
  it("extends the top row outward toward both end cells' edges", () => {
    expectCoords(winningLineCoords([0, 1, 2]), {
      x1: NEAR,
      y1: SIXTH,
      x2: FAR,
      y2: SIXTH,
    });
  });

  it("extends the left column outward toward both end cells' edges", () => {
    expectCoords(winningLineCoords([0, 3, 6]), {
      x1: SIXTH,
      y1: NEAR,
      x2: SIXTH,
      y2: FAR,
    });
  });

  it("extends the main diagonal (top-left to bottom-right) outward", () => {
    expectCoords(winningLineCoords([0, 4, 8]), {
      x1: NEAR,
      y1: NEAR,
      x2: FAR,
      y2: FAR,
    });
  });

  it("extends the anti-diagonal (top-right to bottom-left) outward", () => {
    expectCoords(winningLineCoords([2, 4, 6]), {
      x1: FAR,
      y1: NEAR,
      x2: NEAR,
      y2: FAR,
    });
  });

  it("keeps the line centered on the middle cell (no net offset there)", () => {
    // The middle cell/row stays at 50% on the unchanged axis for every line.
    expect(winningLineCoords([0, 1, 2]).y1).toBeCloseTo(SIXTH, 6);
    expect(winningLineCoords([3, 4, 5]).y1).toBeCloseTo(HALF, 6);
  });
});
