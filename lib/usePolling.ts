"use client";

import { useEffect, useRef, useState } from "react";

interface PollingState<T> {
  data: T | null;
  error: unknown;
  /** Imperatively replace the polled data (e.g. optimistic updates). */
  setData: (value: T) => void;
  /** Force an immediate refetch. */
  refresh: () => void;
}

/**
 * Polls `fetcher` immediately and then every `intervalMs`. Pausing stops new
 * fetches (used while a local write is in flight). Polling is skipped while the
 * tab is hidden and an in-flight request is aborted on unmount.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  paused = false,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // Keep the latest fetcher without retriggering the effect each render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (paused) return;

    let controller: AbortController | null = null;
    let cancelled = false;

    const run = async () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await fetcherRef.current(controller.signal);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== "AbortError") {
          setError(err);
        }
      }
    };

    run();
    const id = setInterval(run, intervalMs);

    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(id);
    };
  }, [intervalMs, paused, tick]);

  return {
    data,
    error,
    setData,
    refresh: () => setTick((t) => t + 1),
  };
}
