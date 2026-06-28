/**
 * Board animation timings (ms), shared by the react-spring marks layer and the
 * callers that schedule around it (RoomGame's deferred AI reply, Replay's cue
 * clears). Kept here, not in a stylesheet, so the spring config and the JS
 * timers that depend on it read from one source.
 */

/** A mark's slide to its settled cell, and a swept mark's slide off the grid. */
export const SHIFT_SLIDE_MS = 280;

/** Drop-in of a freshly placed mark. */
export const PLACE_MS = 320;
