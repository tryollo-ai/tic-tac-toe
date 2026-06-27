import { DEFAULT_SHIFT_MODE, type ShiftMode } from "@/utils/gameLogic";

/**
 * Server-side, in-memory POC config for experimenting with game-rule variants -
 * currently just which {@link ShiftMode} new shifts use. It is deliberately not
 * persisted: it lives for the lifetime of the server process and resets to the
 * default on restart, which is all an internal toggle for "us to test" needs.
 *
 * The value is stashed on `globalThis` (the same singleton pattern as
 * `lib/prisma.ts`) so every server module - the store, the AI turn, and the
 * `/api/internal/game-config` route - reads and writes one shared value even
 * across Next.js dev hot-reloads.
 *
 * Scope note: only *new* shifts read this. Each recorded shift action captures
 * the mode it was played with, so flipping the toggle never rewrites the history
 * of games already in progress or archived.
 */
const globalForGameConfig = globalThis as unknown as {
  shiftMode: ShiftMode | undefined;
};

export function getShiftMode(): ShiftMode {
  return globalForGameConfig.shiftMode ?? DEFAULT_SHIFT_MODE;
}

export function setShiftMode(mode: ShiftMode): void {
  globalForGameConfig.shiftMode = mode;
}
