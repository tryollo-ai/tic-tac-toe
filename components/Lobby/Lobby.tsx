"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, fetchRooms, roomErrorCode } from "@/lib/roomClient";
import { usePolling } from "@/lib/usePolling";
import { modeLabel, type RoomMode, type RoomSummary } from "@/lib/roomTypes";
import MiniBoard from "@/components/MiniBoard/MiniBoard";
import styles from "./styles.module.scss";

const STATUS_LABEL: Record<RoomSummary["status"], string> = {
  waiting: "Waiting",
  "in-progress": "In progress",
  finished: "Finished",
};

export default function Lobby() {
  const router = useRouter();
  const { data: rooms, error } = usePolling<RoomSummary[]>(
    (signal) => fetchRooms(signal),
    3000,
  );

  const [name, setName] = useState("");
  const [mode, setMode] = useState<RoomMode>("two-player");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (creating) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setFormError("Please enter a room name.");
        return;
      }
      setCreating(true);
      setFormError(null);
      try {
        const room = await createRoom(trimmed, mode);
        router.push(`/room/${room.id}`);
      } catch (err) {
        const code = roomErrorCode(err);
        setFormError(
          code === "invalid-name"
            ? "That room name is not valid."
            : "Could not create the room. Please try again.",
        );
        setCreating(false);
      }
    },
    [creating, name, mode, router],
  );

  return (
    <div className={styles.lobby}>
      <header className={styles.header}>
        <h1 className={styles.title}>Tic-Tac-Toe</h1>
        <p className={styles.subtitle}>
          Join a room to play or spectate a live game.
        </p>
      </header>

      <form className={styles.createForm} onSubmit={handleCreate}>
        <input
          className={styles.nameInput}
          type="text"
          placeholder="Room name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          aria-label="Room name"
        />
        <div className={styles.modeToggle} role="group" aria-label="Game mode">
          <button
            type="button"
            className={mode === "two-player" ? styles.modeActive : styles.mode}
            onClick={() => setMode("two-player")}
            aria-pressed={mode === "two-player"}
          >
            2 Player
          </button>
          <button
            type="button"
            className={mode === "ai" ? styles.modeActive : styles.mode}
            onClick={() => setMode("ai")}
            aria-pressed={mode === "ai"}
          >
            vs AI
          </button>
        </div>
        <button type="submit" className={styles.createButton} disabled={creating}>
          {creating ? "Creating…" : "New room"}
        </button>
      </form>
      {formError && <p className={styles.formError}>{formError}</p>}

      {Boolean(error) && !rooms && (
        <p className={styles.loadError}>Could not load rooms. Retrying…</p>
      )}

      {rooms && rooms.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No rooms yet</p>
          <p className={styles.emptyHint}>
            Create the first room above to start playing.
          </p>
        </div>
      )}

      {rooms && rooms.length > 0 && (
        <ul className={styles.roomList}>
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                className={styles.roomCard}
                onClick={() => router.push(`/room/${room.id}`)}
              >
                <MiniBoard board={room.board} />
                <div className={styles.roomInfo}>
                  <span className={styles.roomName}>{room.name}</span>
                  <div className={styles.roomMeta}>
                    <span
                      className={`${styles.badge} ${styles[`badge_${room.status === "in-progress" ? "inProgress" : room.status}`]}`}
                    >
                      {STATUS_LABEL[room.status]}
                    </span>
                    <span className={styles.modeBadge}>
                      {modeLabel(room.mode)}
                    </span>
                  </div>
                  <div className={styles.seats}>
                    <span className={room.seatsTaken.X ? styles.seatTaken : styles.seatOpen}>
                      X {room.seatsTaken.X ? "taken" : "open"}
                    </span>
                    <span className={room.seatsTaken.O ? styles.seatTaken : styles.seatOpen}>
                      O {room.seatsTaken.O ? "taken" : "open"}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
