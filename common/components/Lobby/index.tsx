"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IoHelpCircleOutline } from "react-icons/io5";
import {
  createRoom,
  fetchCompletedGames,
  fetchRooms,
  roomErrorCode,
} from "@/utils/roomClient";
import {
  modeLabel,
  type CompletedGameSummary,
  type RoomMode,
  type RoomSummary,
} from "@/lib/roomTypes";
import type { Board } from "@/utils/gameLogic";
import MiniBoard from "@/common/components/MiniBoard";
import ShiftAnimation from "@/common/components/ShiftAnimation";
import Spinner from "@/common/components/Spinner";
import UIDialog from "@/common/components/UIDialog";
import styles from "./styles.module.scss";

const STATUS_LABEL: Record<RoomSummary["status"], string> = {
  waiting: "Waiting",
  "in-progress": "In progress",
  finished: "Finished",
};

/** Human-readable outcome for a finished game. */
function resultLabel(winner: CompletedGameSummary["winner"]): string {
  return winner ? `${winner} won` : "Draw";
}

/** Compact "time since" label, e.g. "just now", "5m ago", "2h ago". */
function timeAgo(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

const PAGE_SIZE = 6;

/**
 * The shared card shell for both lobby lists (live rooms and completed games):
 * a clickable card with a board preview, the name, a status/result badge beside
 * the mode badge, and a list-specific footer passed as children.
 */
const GameCard = (props: {
  board: Board;
  name: string;
  mode: RoomMode;
  onClick: () => void;
  badgeClass: string;
  badgeLabel: string;
  children: React.ReactNode;
}) => (
  <li>
    <button type="button" className={styles.roomCard} onClick={props.onClick}>
      <MiniBoard board={props.board} />
      <div className={styles.roomInfo}>
        <span className={styles.roomName}>{props.name}</span>
        <div className={styles.roomMeta}>
          <span className={props.badgeClass}>{props.badgeLabel}</span>
          <span className={styles.modeBadge}>{modeLabel(props.mode)}</span>
        </div>
        {props.children}
      </div>
    </button>
  </li>
);

const Lobby = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: rooms,
    error,
    isLoading: roomsLoading,
  } = useQuery<RoomSummary[]>({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => fetchRooms(signal),
    refetchInterval: 3000,
  });
  const { data: completed } = useQuery<CompletedGameSummary[]>({
    queryKey: ["completed"],
    queryFn: ({ signal }) => fetchCompletedGames(signal),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (vars: { name: string; mode: RoomMode }) =>
      createRoom(vars.name, vars.mode),
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      router.push(`/room/${room.id}`);
    },
  });

  const [name, setName] = useState("");
  const [mode, setMode] = useState<RoomMode>("two-player");
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [howToOpen, setHowToOpen] = useState(false);

  const totalRooms = rooms?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRooms / PAGE_SIZE));
  // Polling can shrink the list (rooms get reaped), so clamp the active page.
  const activePage = Math.min(page, totalPages - 1);
  const pageRooms = rooms?.slice(
    activePage * PAGE_SIZE,
    activePage * PAGE_SIZE + PAGE_SIZE,
  );

  useEffect(() => {
    if (page !== activePage) setPage(activePage);
  }, [page, activePage]);

  const handleCreate = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (createMutation.isPending) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setFormError("Please enter a room name.");
        return;
      }
      setFormError(null);
      try {
        await createMutation.mutateAsync({ name: trimmed, mode });
      } catch (err) {
        const code = roomErrorCode(err);
        setFormError(
          code === "invalid-name"
            ? "That room name is not valid."
            : "Could not create the room. Please try again.",
        );
      }
    },
    [createMutation, name, mode],
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Tic-Tac-Toe</h1>
          <button
            type="button"
            className={styles.howToButton}
            onClick={() => setHowToOpen(true)}
          >
            <IoHelpCircleOutline className={styles.howToIcon} />
            How to play
          </button>
        </div>
        <p className={styles.subtitle}>
          A twist on tic-tac-toe: player O goes second but gets a one-time grid
          shift. Join a room to play or spectate a live game.
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
        <button
          type="submit"
          className={styles.createButton}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "New room"}
        </button>
      </form>
      {formError && <p className={styles.formError}>{formError}</p>}

      {roomsLoading && <Spinner label="Loading rooms…" />}

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

      {rooms && rooms.length > 0 && pageRooms && (
        <ul className={styles.roomList}>
          {pageRooms.map((room) => (
            <GameCard
              key={room.id}
              board={room.board}
              name={room.name}
              mode={room.mode}
              onClick={() => router.push(`/room/${room.id}`)}
              badgeClass={`${styles.badge} ${styles[`badge_${room.status === "in-progress" ? "inProgress" : room.status}`]}`}
              badgeLabel={STATUS_LABEL[room.status]}
            >
              <div className={styles.seats}>
                <span className={room.seatsTaken.X ? styles.seatTaken : styles.seatOpen}>
                  X {room.seatsTaken.X ? "taken" : "open"}
                </span>
                <span className={room.seatsTaken.O ? styles.seatTaken : styles.seatOpen}>
                  O {room.seatsTaken.O ? "taken" : "open"}
                </span>
              </div>
            </GameCard>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Rooms pages">
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={activePage === 0}
          >
            Previous
          </button>
          <span className={styles.pageStatus} aria-live="polite">
            Page {activePage + 1} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={activePage === totalPages - 1}
          >
            Next
          </button>
        </nav>
      )}

      {completed && completed.length > 0 && (
        <section className={styles.completedSection}>
          <h2 className={styles.sectionTitle}>Completed games</h2>
          <p className={styles.sectionHint}>
            Finished games can no longer be played, but you can replay them turn
            by turn.
          </p>
          <ul className={styles.roomList}>
            {completed.map((game) => (
              <GameCard
                key={game.id}
                board={game.board}
                name={game.name}
                mode={game.mode}
                onClick={() => router.push(`/replay/${game.id}`)}
                badgeClass={`${styles.badge} ${game.winner ? styles[`badge_${game.winner === "X" ? "x" : "o"}`] : styles.badge_draw}`}
                badgeLabel={resultLabel(game.winner)}
              >
                <div className={styles.completedFooter}>
                  <span className={styles.replayHint}>▶ Replay</span>
                  <span className={styles.completedTime}>
                    {timeAgo(game.completedAt, Date.now())}
                  </span>
                </div>
              </GameCard>
            ))}
          </ul>
        </section>
      )}

      <UIDialog
        isOpen={howToOpen}
        close={() => setHowToOpen(false)}
        title="How to play"
        description="Tic-tac-toe, with a twist for player O."
      >
        <p className={styles.howToParagraph}>
          The board is a 3x3 grid. Player X always moves first and player O
          moves second; you take turns placing your mark, and the first to line
          up three in a row - across, down, or diagonally - wins.
        </p>
        <p className={styles.howToParagraph}>
          To balance going second, player O gets one special ability: a
          once-per-game <strong>grid shift</strong>. On O&apos;s turn, instead of
          placing a mark, O can slide the whole grid one cell - up, down, left,
          or right. Any marks pushed off the leading edge fall off the board and
          are removed.
        </p>
        <p className={styles.howToParagraph}>
          The shift uses up O&apos;s turn, so players still alternate strictly, and
          O only gets it once per game. A shift only translates marks, so it can
          never complete a line and never wins on its own - it is purely O&apos;s
          compensation for moving second.
        </p>
        <ShiftAnimation />
      </UIDialog>
    </div>
  );
};

export default Lobby;
