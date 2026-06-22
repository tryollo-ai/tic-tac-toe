"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ttt-player-id";

/**
 * Returns a stable per-browser player id from localStorage, creating one on
 * first use. Returns null until mounted to avoid SSR hydration mismatch.
 */
export function usePlayerId(): string | null {
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    let stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      stored = crypto.randomUUID();
      window.localStorage.setItem(STORAGE_KEY, stored);
    }
    setPlayerId(stored);
  }, []);

  return playerId;
}
