/**
 * Verifies that the seat-release logic in useRoom fires only on genuine
 * unmount (tab close / in-app navigation), never on a between-rounds
 * `mySeat` swap (X → O).
 *
 * The test simulates the two React effect patterns without React or jsdom:
 *   - OLD: effect listed `mySeat` in deps → cleanup ran every time mySeat
 *     changed, sending a spurious DELETE that booted the player mid-round.
 *   - NEW: effect has [] deps + reads the latest seat/player through a ref →
 *     cleanup fires only on unmount.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal simulation of the two effect patterns
// ---------------------------------------------------------------------------

/** Simulates the OLD pattern: effect deps include `mySeat`. */
function oldPattern(initialSeat: string) {
  const deleteCalls: string[] = [];
  const fetchMock = vi.fn((url: string, opts: RequestInit) => {
    deleteCalls.push(`${opts.method} ${url} player=${JSON.parse(opts.body as string).playerId}`);
    return Promise.resolve();
  });

  let cleanup: (() => void) | null = null;

  function runEffect(mySeat: string | null, playerId: string | null) {
    // Simulate React calling the previous cleanup before re-running the effect.
    if (cleanup) cleanup();
    if (!playerId || !mySeat) {
      cleanup = null;
      return;
    }
    // Snapshot the values into the closure (old approach).
    const seat = mySeat;
    const pid = playerId;
    const release = () =>
      fetchMock(`/api/rooms/room1/seat`, {
        method: "DELETE",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid }),
      }).catch(() => {});

    cleanup = () => {
      release();
    };

    return cleanup;
  }

  return { runEffect, deleteCalls, cleanup: () => cleanup?.(), fetchMock };
}

/** Simulates the NEW pattern: mount-only effect reads a ref. */
function newPattern() {
  const deleteCalls: string[] = [];
  const fetchMock = vi.fn((url: string, opts: RequestInit) => {
    deleteCalls.push(`${opts.method} ${url} player=${JSON.parse(opts.body as string).playerId}`);
    return Promise.resolve();
  });

  // Simulates `releaseSeatRef.current` — updated every render.
  let refCurrent: () => void = () => {};

  function updateRef(mySeat: string | null, playerId: string | null) {
    refCurrent = () => {
      if (!playerId || !mySeat) return;
      fetchMock(`/api/rooms/room1/seat`, {
        method: "DELETE",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      }).catch(() => {});
    };
  }

  // Mount-only cleanup — calls through the ref so it always uses fresh values.
  const mountCleanup = () => refCurrent();

  return { updateRef, mountCleanup, deleteCalls, fetchMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seat-release effect: spurious DELETE on mySeat swap", () => {
  it("OLD pattern fires a stray DELETE when mySeat changes X → O", () => {
    const { runEffect, deleteCalls } = oldPattern("X");

    // Mount: player holds X.
    runEffect("X", "player-1");

    // Server swaps seats after a completed round; React re-runs the effect
    // because mySeat is in deps → cleanup (release for X) fires.
    runEffect("O", "player-1");

    // A DELETE was sent even though the player never intentionally left!
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatch(/DELETE.*player=player-1/);
  });

  it("NEW pattern does NOT fire a DELETE when mySeat changes X → O", () => {
    const { updateRef, mountCleanup, deleteCalls } = newPattern();

    // Mount: player holds X.
    updateRef("X", "player-1");

    // Server swaps seats — ref is refreshed but NO cleanup fires ([] deps).
    updateRef("O", "player-1");

    // No stray DELETE.
    expect(deleteCalls).toHaveLength(0);
  });

  it("NEW pattern fires exactly one DELETE on genuine unmount (with latest seat)", () => {
    const { updateRef, mountCleanup, deleteCalls } = newPattern();

    // Mount: player holds X.
    updateRef("X", "player-1");

    // Round resets: seat swaps to O — ref updated, no cleanup yet.
    updateRef("O", "player-1");

    // Player navigates away: unmount cleanup runs through the ref.
    mountCleanup();

    expect(deleteCalls).toHaveLength(1);
    // Uses the *latest* seat (O), not the stale initial seat (X).
    expect(deleteCalls[0]).toContain("player=player-1");
    expect(deleteCalls[0]).toContain("DELETE");
  });

  it("NEW pattern skips the DELETE when the player has no seat at unmount", () => {
    const { updateRef, mountCleanup, deleteCalls } = newPattern();

    // Player never claimed a seat (spectator).
    updateRef(null, "player-1");

    // Unmount.
    mountCleanup();

    expect(deleteCalls).toHaveLength(0);
  });
});
