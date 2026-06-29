"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IoHelpCircleOutline } from "react-icons/io5";
import {
  createRoom,
  fetchCompletedGames,
  fetchGameConfig,
  fetchPlayerStats,
  fetchRooms,
  roomErrorCode,
} from "@/utils/roomClient";
import {
  modeLabel,
  type CompletedGameSummary,
  type PlayerStats,
  type RoomMode,
  type RoomSummary,
} from "@/lib/roomTypes";
import type { Board, ShiftMode } from "@/utils/gameLogic";
import { usePlayerId } from "@/lib/usePlayerId";
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
  const playerId = usePlayerId();
  const {
    data: rooms,
    error,
    isLoading: roomsLoading,
  } = useQuery<RoomSummary[]>({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => fetchRooms(signal),
    refetchInterval: 3000,
  });
  // Only the games this browser took part in; gated on the player id being ready.
  const { data: completed } = useQuery<CompletedGameSummary[]>({
    queryKey: ["completed", playerId],
    queryFn: ({ signal }) => fetchCompletedGames(playerId as string, signal),
    enabled: Boolean(playerId),
    refetchInterval: 5000,
  });
  // This browser's lifetime win/loss/draw record, tallied on the server from the
  // same archive; polled alongside the completed list so it stays in step.
  const { data: stats } = useQuery<PlayerStats>({
    queryKey: ["stats", playerId],
    queryFn: ({ signal }) => fetchPlayerStats(playerId as string, signal),
    enabled: Boolean(playerId),
    refetchInterval: 5000,
  });
  // The active game config (internal POC toggles) so the "How to play" dialog
  // explains and animates the shift variant new games will actually use.
  const { data: gameConfig } = useQuery({
    queryKey: ["game-config"],
    queryFn: ({ signal }) => fetchGameConfig(signal),
  });
  const activeShiftMode: ShiftMode = gameConfig?.shiftMode ?? "classic";
  // Reflect the size/win run new games are created at, so the dialog's rules and
  // the abilities it explains match what the player is about to play.
  const activeSize = gameConfig?.boardSize ?? 3;
  const activeWinLength = gameConfig?.winLength ?? 3;

  // Only online multiplayer creates a server room; single-device games are
  // started straight from the client (see startClientGame), so the mutation is
  // always a two-player create.
  const createMutation = useMutation({
    mutationFn: (roomName: string) => createRoom(roomName, "two-player"),
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      router.push(`/room/${room.id}`);
    },
  });

  const [name, setName] = useState("");
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

  // Create an online multiplayer room (the only mode that lives on the server)
  // and join it. A name is required so the room is identifiable in the lobby.
  const handleCreateRoom = useCallback(
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
        await createMutation.mutateAsync(trimmed);
      } catch (err) {
        const code = roomErrorCode(err);
        setFormError(
          code === "invalid-name"
            ? "That room name is not valid."
            : "Could not create the room. Please try again.",
        );
      }
    },
    [createMutation, name],
  );

  // Start a single-device game (vs-AI or local pass-and-play). These run wholly
  // in the browser - no server room, no name - so it is a plain navigation.
  const startClientGame = useCallback(
    (clientMode: "ai" | "local") => router.push(`/play/${clientMode}`),
    [router],
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Trick-Tac-Toe</h1>
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
          A twist on tic-tac-toe: player O goes second but gets a one-time
          trick. Join a room to play or spectate a live game.
        </p>
      </header>

      <div className={styles.body}>
        <div className={styles.mainColumn}>
          {/* Single-device games: start instantly, no room or name needed. */}
          <div className={styles.quickPlay}>
            <button
              type="button"
              className={styles.quickPlayButton}
              onClick={() => startClientGame("ai")}
            >
              Play vs AI
            </button>
            <button
              type="button"
              className={styles.quickPlayButton}
              onClick={() => startClientGame("local")}
            >
              Play local
            </button>
          </div>

          {/* Online multiplayer: name the room and create it on the server. */}
          <form className={styles.createForm} onSubmit={handleCreateRoom}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Create multiplayer room"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              aria-label="Create multiplayer room"
            />
            <button
              type="submit"
              className={styles.createButton}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create room"}
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
            <section className={styles.listSection}>
              <h2 className={styles.sectionTitle}>Open rooms</h2>
              <p className={styles.sectionHint}>
                Join a live multiplayer room to play, or spectate a game in
                progress.
              </p>
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
            </section>
          )}

          {completed && completed.length > 0 && (
            <section className={styles.listSection}>
              <h2 className={styles.sectionTitle}>Your completed games</h2>
              <p className={styles.sectionHint}>
                Games you have finished can no longer be played, but you can
                replay them turn by turn.
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
        </div>

        {stats && stats.won + stats.lost + stats.drawn > 0 && (
          <aside className={styles.statsPanel} aria-label="Your record">
            <span className={styles.statsTitle}>Your record</span>
            <dl className={styles.statsList}>
              <div className={styles.statRow}>
                <dt className={styles.statLabel}>Won</dt>
                <dd className={`${styles.statValue} ${styles.statWon}`}>
                  {stats.won}
                </dd>
              </div>
              <div className={styles.statRow}>
                <dt className={styles.statLabel}>Lost</dt>
                <dd className={`${styles.statValue} ${styles.statLost}`}>
                  {stats.lost}
                </dd>
              </div>
              <div className={styles.statRow}>
                <dt className={styles.statLabel}>Draw</dt>
                <dd className={styles.statValue}>{stats.drawn}</dd>
              </div>
            </dl>
          </aside>
        )}
      </div>

      <UIDialog
        isOpen={howToOpen}
        close={() => setHowToOpen(false)}
        title="How to play"
        description="Trick-tac-toe - tic-tac-toe, but with a twist!"
      >
        <p className={styles.howToParagraph}>
          X moves first, O second - take turns
          placing marks, and the first to line up {activeWinLength} in a row
          (across, down, or diagonally) wins.
        </p>
        <p className={styles.howToParagraph}>
          The twist: once per game, instead of placing a mark, O can play a{" "}
          <strong>trick</strong> that reshapes the whole board:
        </p>
        <ShiftAnimation mode={activeShiftMode} />
        <p className={styles.howToParagraph} style={{ marginTop: 24 }}>
          On larger boards, Player X also earns a trick to slide the board in
          any direction by 1.
        </p>
      </UIDialog>
    </div>
  );
};

export default Lobby;
