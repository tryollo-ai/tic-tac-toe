import { useRef } from "react";

/**
 * Build a one-shot animation cue in the very render a counter changes, instead
 * of in an effect (which lands a render late - the board would advance with no
 * cue, snap the change in, then fire the cue with nothing left to animate).
 *
 * Tracks `count` across renders. On each *change* it calls `build(count, prev)`,
 * which returns the cue describing that transition, or null when the change
 * should not animate (a jump, a rewind, or the first render). The result is held
 * in a ref so the same object identity is returned on later unrelated renders -
 * consumers (e.g. `<Board>`) animate only on a fresh identity, so a stable ref
 * is what stops a cue from re-firing; no clear-after-timeout is needed.
 *
 * `count` may be null while the underlying data is still loading; the cue holds
 * until a real value arrives. `initial` seeds the previous-value ref so the
 * first observed value reports no cue (nothing to animate from on mount).
 *
 * Mutating the refs during render is strict-mode-safe: the second invocation of
 * a double-rendered pass sees `count === prev` and is a no-op.
 */
export function useStepCue<Cue>(
  count: number | null,
  build: (count: number, prev: number | null) => Cue | null,
  initial: number | null = null,
): Cue | null {
  const prevRef = useRef<number | null>(initial);
  const cueRef = useRef<Cue | null>(null);
  if (count !== null && count !== prevRef.current) {
    const prev = prevRef.current;
    prevRef.current = count;
    cueRef.current = build(count, prev);
  }
  return cueRef.current;
}
