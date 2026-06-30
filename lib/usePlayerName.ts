"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ttt-player-name";

/** Longest name a player may choose; mirrors the store's clamp. */
export const MAX_PLAYER_NAME_LEN = 20;

/**
 * A stable per-browser display name, persisted in localStorage so the same name
 * is reused across rooms and survives reloads. Returns the current name (empty
 * until mounted, to avoid an SSR hydration mismatch) and a setter that writes
 * through to storage. The value is stored verbatim; trimming/clamping happens at
 * the store boundary when it is sent with a seat claim.
 */
export function usePlayerName(): [string, (name: string) => void] {
  const [name, setName] = useState("");

  useEffect(() => {
    setName(window.localStorage.getItem(STORAGE_KEY) ?? "");
  }, []);

  const update = useCallback((next: string) => {
    const clipped = next.slice(0, MAX_PLAYER_NAME_LEN);
    setName(clipped);
    window.localStorage.setItem(STORAGE_KEY, clipped);
  }, []);

  return [name, update];
}
