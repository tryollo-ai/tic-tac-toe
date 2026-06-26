"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeRoom } from "@/utils/roomClient";
import type { RoomView } from "@/lib/roomTypes";

/** Stream callbacks the caller cares about; identity may change each render. */
type Handlers = {
  /** A fresh room view arrived over the stream. */
  onRoom: (room: RoomView) => void;
  /** The server reported the room no longer exists. */
  onGone?: () => void;
};

/**
 * Subscribe to a room's Server-Sent Events for the component's lifetime and
 * report whether the stream is currently connected. Callers use the connected
 * flag to slow their polling fallback while live updates are flowing, and to
 * speed it back up if the stream drops.
 *
 * Handlers are read through a ref so a parent re-render that hands in fresh
 * callbacks doesn't tear down and reopen the connection; only `id`/`playerId`
 * changes resubscribe.
 */
export function useRoomStream(
  id: string,
  playerId: string | null,
  handlers: Handlers,
): boolean {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!playerId) return;
    setConnected(false);

    const unsubscribe = subscribeRoom(id, playerId, {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      onRoom: (room) => handlersRef.current.onRoom(room),
      onGone: () => {
        setConnected(false);
        handlersRef.current.onGone?.();
      },
    });

    return () => {
      setConnected(false);
      unsubscribe();
    };
  }, [id, playerId]);

  return connected;
}
