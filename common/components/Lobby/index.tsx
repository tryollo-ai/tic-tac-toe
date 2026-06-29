"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
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

/** This browser's lifetime win/loss/draw tally, shown beside the room lists. */
const RecordPanel = (props: { stats: PlayerStats }) => (
  <aside className={styles.statsPanel} aria-label="Your record">
    <span className={styles.statsTitle}>Your record</span>
    <dl className={styles.statsList}>
      <div className={styles.statRow}>
        <dt className={styles.statLabel}>Won</dt>
        <dd className={`${styles.statValue} ${styles.statWon}`}>
          {props.stats.won}
        </dd>
      </div>
      <div className={styles.statRow}>
        <dt className={styles.statLabel}>Lost</dt>
        <dd className={`${styles.statValue} ${styles.statLost}`}>
          {props.stats.lost}
        </dd>
      </div>
      <div className={styles.statRow}>
        <dt className={styles.statLabel}>Draw</dt>
        <dd className={styles.statValue}>{props.stats.drawn}</dd>
      </div>
    </dl>
  </aside>
);

/**
 * The "How to play" modal: explains the rules and animates the shift variant
 * that new games are currently created with, so it matches the active config.
 */
const HowToPlayDialog = (props: {
  isOpen: boolean;
  close: () => void;
  winLength: number;
  shiftMode: ShiftMode;
}) => (
  <UIDialog
    isOpen={props.isOpen}
    close={props.close}
    title="How to play"
    description="Tic tac toe - but with a twist!"
  >
    <p className={styles.howToParagraph}>
      X moves first, O second - take turns placing marks, and the first to line
      up {props.winLength} in a row (across, down, or diagonally) wins.
    </p>
    <p className={styles.howToParagraph}>
      The twist: once per game, instead of placing a mark, O can reshape the
      whole board with <strong>Grid Collapse</strong>:
    </p>
    <ShiftAnimation mode={props.shiftMode} />
    <p className={styles.howToParagraph} style={{ marginTop: 24 }}>
      On larger boards, Player X also gets the ability to shift the board in any
      direction by 1.
    </p>
  </UIDialog>
);

/**
 * The "Open rooms" list: a page of joinable/spectatable live rooms (each a
 * GameCard with a per-seat taken/open footer) plus prev/next pagination when the
 * full list spans more than one page. Joining is delegated to `onJoin`; paging is
 * driven entirely by the parent's clamped page state.
 */
const OpenRoomsSection = (props: {
  rooms: RoomSummary[];
  totalPages: number;
  activePage: number;
  setPage: Dispatch<SetStateAction<number>>;
  onJoin: (id: string) => void;
}) => (
  <section className={styles.listSection}>
    <h2 className={styles.sectionTitle}>Open rooms</h2>
    <p className={styles.sectionHint}>
      Join a live multiplayer room to play, or spectate a game in progress.
    </p>
    <ul className={styles.roomList}>
      {props.rooms.map((room) => (
        <GameCard
          key={room.id}
          board={room.board}
          name={room.name}
          mode={room.mode}
          onClick={() => props.onJoin(room.id)}
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

    {props.totalPages > 1 && (
      <nav className={styles.pagination} aria-label="Rooms pages">
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => props.setPage((p) => Math.max(0, p - 1))}
          disabled={props.activePage === 0}
        >
          Previous
        </button>
        <span className={styles.pageStatus} aria-live="polite">
          Page {props.activePage + 1} of {props.totalPages}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => props.setPage((p) => Math.min(props.totalPages - 1, p + 1))}
          disabled={props.activePage === props.totalPages - 1}
        >
          Next
        </button>
      </nav>
    )}
  </section>
);

/**
 * The "Your completed games" list: the games this browser finished, each a
 * GameCard whose badge shows the outcome and whose footer offers a turn-by-turn
 * replay plus a relative finish time. Opening a replay is delegated to `onReplay`.
 */
const CompletedGamesSection = (props: {
  games: CompletedGameSummary[];
  onReplay: (id: string) => void;
}) => (
  <section className={styles.listSection}>
    <h2 className={styles.sectionTitle}>Your completed games</h2>
    <p className={styles.sectionHint}>
      Games you have finished can no longer be played, but you can replay them
      turn by turn.
    </p>
    <ul className={styles.roomList}>
      {props.games.map((game) => (
        <GameCard
          key={game.id}
          board={game.board}
          name={game.name}
          mode={game.mode}
          onClick={() => props.onReplay(game.id)}
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
);

/**
 * The main column's results region: the load spinner, the fetch-error and
 * empty-list notices, and - once rooms exist - the paginated open-rooms list
 * and this browser's completed-games list. Each block is gated by the data it
 * needs, so exactly one of spinner/error/empty/list shows at a time. Pure
 * presentation; the already-sliced page, pagination state, and navigation
 * handlers all arrive via props.
 */
const RoomResults = (props: {
  roomsLoading: boolean;
  hasError: boolean;
  rooms: RoomSummary[] | undefined;
  pageRooms: RoomSummary[] | undefined;
  totalPages: number;
  activePage: number;
  setPage: Dispatch<SetStateAction<number>>;
  completed: CompletedGameSummary[] | undefined;
  onJoin: (id: string) => void;
  onReplay: (id: string) => void;
}) => (
  <>
    {props.roomsLoading && <Spinner label="Loading rooms…" />}

    {props.hasError && !props.rooms && (
      <p className={styles.loadError}>Could not load rooms. Retrying…</p>
    )}

    {props.rooms && props.rooms.length === 0 && (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No rooms yet</p>
        <p className={styles.emptyHint}>
          Create the first room above to start playing.
        </p>
      </div>
    )}

    {props.rooms && props.rooms.length > 0 && props.pageRooms && (
      <OpenRoomsSection
        rooms={props.pageRooms}
        totalPages={props.totalPages}
        activePage={props.activePage}
        setPage={props.setPage}
        onJoin={props.onJoin}
      />
    )}

    {props.completed && props.completed.length > 0 && (
      <CompletedGamesSection games={props.completed} onReplay={props.onReplay} />
    )}
  </>
);

/**
 * The lobby's title row (heading + "How to play" trigger) and intro blurb.
 * Pure presentation; opening the dialog is delegated to `onHowTo`.
 */
const LobbyHeader = (props: { onHowTo: () => void }) => (
  <header className={styles.header}>
    <div className={styles.titleRow}>
      <h1 className={styles.title}>Tic-Tac-Toe</h1>
      <button
        type="button"
        className={styles.howToButton}
        onClick={props.onHowTo}
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
);

/**
 * The "start a game" controls at the top of the main column: the two
 * single-device quick-play buttons (vs-AI, local) and the create-a-multiplayer-
 * room form with its inline validation/error message. All state lives in the
 * parent; this just wires the inputs and buttons to the handlers it is given.
 */
const StartPanel = (props: {
  onStartClient: (mode: "ai" | "local") => void;
  name: string;
  setName: (name: string) => void;
  onCreate: (event: React.FormEvent) => void;
  creating: boolean;
  formError: string | null;
}) => (
  <>
    {/* Single-device games: start instantly, no room or name needed. */}
    <div className={styles.quickPlay}>
      <button
        type="button"
        className={styles.quickPlayButton}
        onClick={() => props.onStartClient("ai")}
      >
        Play vs AI
      </button>
      <button
        type="button"
        className={styles.quickPlayButton}
        onClick={() => props.onStartClient("local")}
      >
        Play local
      </button>
    </div>

    {/* Online multiplayer: name the room and create it on the server. */}
    <form className={styles.createForm} onSubmit={props.onCreate}>
      <input
        className={styles.nameInput}
        type="text"
        placeholder="Create multiplayer room"
        value={props.name}
        maxLength={40}
        onChange={(e) => props.setName(e.target.value)}
        aria-label="Create multiplayer room"
      />
      <button
        type="submit"
        className={styles.createButton}
        disabled={props.creating}
      >
        {props.creating ? "Creating…" : "Create room"}
      </button>
    </form>
    {props.formError && <p className={styles.formError}>{props.formError}</p>}
  </>
);

/**
 * The lobby's read-only server-data layer: the live-room list, this browser's
 * completed games and lifetime win/loss/draw record, and the active game config
 * (with defaults applied so the "How to play" dialog explains the variant new
 * games will actually use). All four poll independently; gathering them in one
 * hook keeps the component body to local interaction state plus render.
 */
const useLobbyData = (playerId: string | null) => {
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

  return {
    rooms,
    error,
    roomsLoading,
    completed,
    stats,
    activeShiftMode: (gameConfig?.shiftMode ?? "classic") as ShiftMode,
    activeWinLength: gameConfig?.winLength ?? 3,
  };
};

const Lobby = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const playerId = usePlayerId();
  const {
    rooms,
    error,
    roomsLoading,
    completed,
    stats,
    activeShiftMode,
    activeWinLength,
  } = useLobbyData(playerId);

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
      <LobbyHeader onHowTo={() => setHowToOpen(true)} />

      <div className={styles.body}>
        <div className={styles.mainColumn}>
          <StartPanel
            onStartClient={startClientGame}
            name={name}
            setName={setName}
            onCreate={handleCreateRoom}
            creating={createMutation.isPending}
            formError={formError}
          />

          <RoomResults
            roomsLoading={roomsLoading}
            hasError={Boolean(error)}
            rooms={rooms}
            pageRooms={pageRooms}
            totalPages={totalPages}
            activePage={activePage}
            setPage={setPage}
            completed={completed}
            onJoin={(id) => router.push(`/room/${id}`)}
            onReplay={(id) => router.push(`/replay/${id}`)}
          />
        </div>

        {stats && stats.won + stats.lost + stats.drawn > 0 && (
          <RecordPanel stats={stats} />
        )}
      </div>

      <HowToPlayDialog
        isOpen={howToOpen}
        close={() => setHowToOpen(false)}
        winLength={activeWinLength}
        shiftMode={activeShiftMode}
      />
    </div>
  );
};

export default Lobby;
