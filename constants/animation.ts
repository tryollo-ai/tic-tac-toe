/**
 * Board animation timings (ms), shared by the react-spring marks layer and the
 * callers that schedule around it (RoomGame's deferred AI reply, Replay's cue
 * clears). Kept here, not in a stylesheet, so the spring config and the JS
 * timers that depend on it read from one source.
 */

/**
 * Budget RoomGame's deferred AI reply allows for a shift's marks to slide and
 * settle before the AI's move is revealed. The slide itself animates on a spring
 * in <Board>, so this is a comfortable upper bound on its settle time, not the
 * exact animation length.
 */
export const SHIFT_SLIDE_MS = 280;

/** Drop-in of a freshly placed mark. */
export const PLACE_MS = 320;
