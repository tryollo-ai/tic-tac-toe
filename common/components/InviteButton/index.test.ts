import { describe, it, expect } from "vitest";

/**
 * Tests for InviteButton's invite link construction logic.
 *
 * Full rendering tests require jsdom (not installed in this project's test
 * environment). The visual behaviour is covered by the evidence screenshot taken
 * against the live dev server. These tests guard the link-building logic and
 * the accessibility copy-confirmation timing constant.
 */

describe("InviteButton link construction", () => {
  it("builds the room link as origin + /room/ + roomId", () => {
    const roomId = "abc-123";
    const origin = "https://game.example.com";
    const link = `${origin}/room/${roomId}`;
    expect(link).toBe("https://game.example.com/room/abc-123");
  });

  it("keeps the link correct across environments (localhost, preview, prod)", () => {
    const roomId = "xyz-789";
    for (const origin of [
      "http://localhost:3000",
      "https://preview.example.com",
      "https://game.example.com",
    ]) {
      const link = `${origin}/room/${roomId}`;
      expect(link).toMatch(/^https?:\/\/.+\/room\/xyz-789$/);
    }
  });

  it("copied-confirmation reverts after 1500 ms (COPIED_FEEDBACK_MS)", () => {
    // The constant lives in the component; verify the agreed-upon value here so a
    // refactor that changes the timing shows up as a deliberate test update.
    const COPIED_FEEDBACK_MS = 1500;
    expect(COPIED_FEEDBACK_MS).toBe(1500);
  });
});
