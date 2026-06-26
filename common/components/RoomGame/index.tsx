"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  claimSeat,
  fetchRoom,
  leaveSeat,
  makeMove,
  resetRoom,
  RoomError,
  roomErrorCode,
  shiftRoom,
} from "@/utils/roomClient";
import { usePlayerId } from "@/lib/usePlayerId";
import type { Direction, Player } from "@/utils/gameLogic";
import type { RoomView } from "@/lib/roomTypes";
import Board from "@/common/components/Board";
import BoardHistory from "@/common/components/BoardHistory";
import RoomHeader from "@/common/components/RoomHeader";
import RoomNotFound, { RoomLoading } from "@/common/components/RoomMessage";
import Status, {
  type StatusInfo,
  playerTone,
  spectatorStatus,
} from "@/common/components/Status";
import Scoreboard from "@/common/components/Scoreboard";
import styles from "./styles.module.scss";

type Props = {
  id: string;
};

/** User-facing copy for the room error codes the UI can surface. */
const ROOM_ERROR_MESSAGES: Record<string, string> = {
  "not-your-turn": "It is not your turn.",
  "cell-taken": "That cell is already taken.",
  "game-over": "The game is already over.",
  "seat-taken": "That seat was just taken.",
  "not-participant": "Only a seated player can do that.",
  "shift-used": "You have already used your shift.",
};

/**
 * The four grid-shift choices. Each renders as a single arrow on the matching
 * edge of the board (`slotClass`), with a spelled-out label for assistive tech.
 */
const SHIFT_OPTIONS: {
  dir: Direction;
  glyph: string;
  label: string;
  slotClass: "shiftSlotTop" | "shiftSlotBottom" | "shiftSlotLeft" | "shiftSlotRight";
}[] = [
  { dir: "top", glyph: "↑", label: "Shift up", slotClass: "shiftSlotTop" },
  { dir: "bottom", glyph: "↓", label: "Shift down", slotClass: "shiftSlotBottom" },
  { dir: "left", glyph: "←", label: "Shift left", slotClass: "shiftSlotLeft" },
  { dir: "right", glyph: "→", label: "Shift right", slotClass: "shiftSlotRight" },
];

/**
 * How long a finished game stays on screen before the room auto-resets to a
 * fresh game. Long enough to read the result, short enough to keep play moving.
 */
const AUTO_RESET_MS = 4500;

/** Map a thrown error to a known room-error message, or the given fallback. */
function roomErrorMessage(err: unknown, fallback: string): string {
  return ROOM_ERROR_MESSAGES[roomErrorCode(err)] ?? fallback;
}

const RoomGame = (props: Props) => {
  const playerId = usePlayerId();
  const queryClient = useQueryClient();
  // Polling pauses while a local write is in flight so a stale GET can't clobber
  // the optimistic/authoritative state.
  const [paused, setPaused] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Whether O has armed the grid shift and is now picking a direction. The
  // direction buttons live around the board perimeter only while this is on.
  const [shiftActive, setShiftActive] = useState(false);

  const roomKey = useMemo(
    () => ["room", props.id, playerId] as const,
    [props.id, playerId],
  );

  const { data: room, error } = useQuery<RoomView>({
    queryKey: roomKey,
    queryFn: ({ signal }) => fetchRoom(props.id, playerId, signal),
    refetchInterval: paused ? false : 1500,
  });

  // Imperatively replace the cached room (optimistic and authoritative writes).
  const setRoom = useCallback(
    (value: RoomView) => queryClient.setQueryData(roomKey, value),
    [queryClient, roomKey],
  );

  const notFound =
    error instanceof RoomError && error.code === "room-not-found";

  const mySeat: Player | null = useMemo(() => {
    if (!room || !playerId) return null;
    if (room.seats.X === playerId) return "X";
    if (room.seats.O === playerId) return "O";
    return null;
  }, [room, playerId]);

  // Pause polling and abort any in-flight GET before a local write begins, so a
  // stale response can't land after our optimistic/authoritative update.
  const beginWrite = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: roomKey });
    setPaused(true);
    setActionError(null);
  }, [queryClient, roomKey]);

  // Shared lifecycle for the non-optimistic writes (claim/leave/shift/reset):
  // pause+abort before, adopt the authoritative room on success, surface a
  // fallback message on error, resume polling when settled. Only the request
  // function and the error fallback differ, so each mutation supplies just those.
  const writeOptions = useCallback(
    (fallback: string) => ({
      onMutate: beginWrite,
      onSuccess: setRoom,
      onError: (err: unknown) =>
        setActionError(roomErrorMessage(err, fallback)),
      onSettled: () => setPaused(false),
    }),
    [beginWrite, setRoom],
  );

  const moveMutation = useMutation({
    mutationFn: (index: number) =>
      makeMove(props.id, playerId as string, index),
    onMutate: async (index: number) => {
      await beginWrite();
      const snapshot = queryClient.getQueryData<RoomView>(roomKey);
      if (snapshot && mySeat) {
        const optimisticBoard = snapshot.board.slice();
        optimisticBoard[index] = mySeat;
        // Optimistically reflect the move; the authoritative response (incl. any
        // AI move) wins once it arrives.
        setRoom({
          ...snapshot,
          board: optimisticBoard,
          xIsNext: !snapshot.xIsNext,
        });
      }
      return { snapshot };
    },
    onSuccess: (updated) => setRoom(updated),
    onError: (err, _index, context) => {
      if (context?.snapshot) setRoom(context.snapshot);
      setActionError(roomErrorMessage(err, "Could not make that move."));
    },
    onSettled: () => setPaused(false),
  });

  const claimMutation = useMutation({
    mutationFn: (seat: Player) => claimSeat(props.id, playerId as string, seat),
    ...writeOptions("Could not claim that seat."),
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveSeat(props.id, playerId as string),
    ...writeOptions("Could not leave the seat."),
  });

  const shiftMutation = useMutation({
    mutationFn: (direction: Direction) =>
      shiftRoom(props.id, playerId as string, direction),
    ...writeOptions("Could not shift the grid."),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetRoom(props.id, playerId as string),
    ...writeOptions("Could not start a new game."),
  });

  // Best-effort instant seat release: on tab close via `pagehide`, and on
  // in-app navigation (unmount) via the cleanup. The 30s TTL is the backstop.
  useEffect(() => {
    if (!playerId || !mySeat) return;
    const release = () => {
      fetch(`/api/rooms/${props.id}/seat`, {
        method: "DELETE",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [props.id, playerId, mySeat]);

  const handleMove = useCallback(
    (index: number) => {
      if (!room || !playerId || !mySeat) return;
      const currentTurn: Player = room.xIsNext ? "X" : "O";
      if (
        room.status === "finished" ||
        currentTurn !== mySeat ||
        room.board[index] !== null
      ) {
        return;
      }
      moveMutation.mutate(index);
    },
    [room, playerId, mySeat, moveMutation],
  );

  const handleClaim = useCallback(
    (seat: Player) => {
      if (!playerId) return;
      claimMutation.mutate(seat);
    },
    [playerId, claimMutation],
  );

  const handleLeave = useCallback(() => {
    if (!playerId) return;
    leaveMutation.mutate();
  }, [playerId, leaveMutation]);

  const handleShift = useCallback(
    (direction: Direction) => {
      if (!playerId) return;
      setShiftActive(false);
      shiftMutation.mutate(direction);
    },
    [playerId, shiftMutation],
  );

  // Auto-reset a finished game after a short delay instead of a manual button.
  // Many clients poll the same room, so exactly one seated player schedules the
  // reset (X, falling back to O if the X seat is empty) and a ref guards against
  // re-scheduling while the same finished game is on screen.
  const resetScheduledRef = useRef(false);
  useEffect(() => {
    const finished = room?.status === "finished";
    if (!finished) {
      resetScheduledRef.current = false;
      return;
    }
    if (!playerId || !mySeat || resetScheduledRef.current) return;
    const iSchedule =
      mySeat === "X" || (mySeat === "O" && room.seats.X === null);
    if (!iSchedule) return;

    resetScheduledRef.current = true;
    const timer = setTimeout(() => {
      resetMutation.mutate();
    }, AUTO_RESET_MS);
    return () => {
      clearTimeout(timer);
      resetScheduledRef.current = false;
    };
  }, [room?.status, room?.seats.X, mySeat, playerId, resetMutation]);

  // Disarm the shift picker whenever O can no longer shift (turn passed, shift
  // spent, game ended, seat left), so it never lingers into the next turn.
  const canShiftNow =
    mySeat === "O" &&
    room?.status !== "finished" &&
    room?.xIsNext === false &&
    !room?.oShiftUsed;
  useEffect(() => {
    if (!canShiftNow && shiftActive) setShiftActive(false);
  }, [canShiftNow, shiftActive]);

  if (notFound) {
    return (
      <RoomNotFound
        title="Room no longer exists"
        hint="It may have been removed or the server restarted."
      />
    );
  }

  if (!room) {
    return (
      <RoomLoading>
        {error ? "Could not load the room. Retrying…" : "Loading room…"}
      </RoomLoading>
    );
  }

  const currentTurn: Player = room.xIsNext ? "X" : "O";
  const gameOver = room.status === "finished";
  const winner: Player | null =
    gameOver && room.winningLine
      ? (room.board[room.winningLine[0]] as Player)
      : null;
  const bothSeated = room.seats.X !== null && room.seats.O !== null;
  const xLabel = mySeat === "X" ? "You (X)" : "Player X";
  const oLabel =
    room.mode === "ai" ? "AI (O)" : mySeat === "O" ? "You (O)" : "Player O";

  // Terminal and pure spectator states share their wording with the replay
  // viewer (spectatorStatus); only the seat-aware mid-game lines are bespoke.
  // "Your turn" is checked before the empty-seat case so a solo player who is on
  // turn (e.g. O after swapping seats) is prompted to act rather than told to
  // wait - mirroring canShiftNow, which also drops the bothSeated requirement.
  let status: StatusInfo;
  if (!gameOver && mySeat && currentTurn === mySeat) {
    status = { message: "Your turn", tone: playerTone(currentTurn) };
  } else if (!gameOver && !bothSeated) {
    status = { message: "Waiting for opponent", tone: "neutral" };
  } else if (!gameOver && mySeat) {
    status = { message: "Opponent's turn", tone: playerTone(currentTurn) };
  } else {
    status = spectatorStatus(winner, currentTurn, gameOver);
  }

  const boardDisabled =
    gameOver || mySeat === null || currentTurn !== mySeat || paused;
  const turnActive = (seat: Player) => !gameOver && currentTurn === seat;

  return (
    <div className={styles.root}>
      <RoomHeader name={room.name} mode={room.mode} />

      <Status message={status.message} tone={status.tone} />

      <div className={styles.seatBar}>
        {mySeat ? (
          <button
            type="button"
            className={classNames(styles.seatButton, styles.leaveButton)}
            onClick={handleLeave}
            disabled={paused}
          >
            Leave seat
          </button>
        ) : (
          <>
            {room.seats.X === null && (
              <button
                type="button"
                className={styles.seatButton}
                onClick={() => handleClaim("X")}
                disabled={paused}
              >
                Play as X
              </button>
            )}
            {room.seats.O === null && (
              <button
                type="button"
                className={styles.seatButton}
                onClick={() => handleClaim("O")}
                disabled={paused}
              >
                Play as O
              </button>
            )}
            {room.seats.X !== null && room.seats.O !== null && (
              <span className={styles.spectateBadge}>Spectating</span>
            )}
          </>
        )}
      </div>

      <div className={styles.playArea}>
        <div className={styles.historySlot}>
          <BoardHistory actions={room.actions} />
        </div>

        {/* The board keeps a reserved perimeter while O can shift, so arming the
            picker reveals the direction arrows in already-allotted slots without
            resizing or nudging the board. */}
        <div
          className={classNames(styles.boardFrame, {
            [styles.boardFrameArmed]: canShiftNow,
          })}
        >
          {canShiftNow &&
            shiftActive &&
            SHIFT_OPTIONS.map(({ dir, glyph, label, slotClass }) => (
              <button
                key={dir}
                type="button"
                className={classNames(styles.shiftButton, styles[slotClass])}
                onClick={() => handleShift(dir)}
                disabled={paused}
                aria-label={label}
                title={label}
              >
                {glyph}
              </button>
            ))}

          <div className={styles.boardSlot}>
            <Board
              board={room.board}
              winningLine={room.winningLine}
              onSquareClick={handleMove}
              disabled={boardDisabled}
            />
          </div>
        </div>

        <aside className={styles.infoPanel}>
          <div
            className={classNames(styles.infoRow, {
              [styles.infoRowActive]: turnActive("X"),
            })}
          >
            <span className={classNames(styles.infoName, styles.infoNameX)}>
              {xLabel}
            </span>
            <span className={styles.infoAbility}>Moves first</span>
          </div>

          <div
            className={classNames(styles.infoRow, {
              [styles.infoRowActive]: turnActive("O"),
            })}
          >
            <span className={classNames(styles.infoName, styles.infoNameO)}>
              {oLabel}
            </span>
            <span
              className={classNames(styles.shiftStatus, {
                [styles.shiftStatusUsed]: room.oShiftUsed,
              })}
            >
              Grid shift: {room.oShiftUsed ? "used" : "available"}
            </span>

            {canShiftNow && (
              <div className={styles.shiftControls}>
                <button
                  type="button"
                  className={classNames(styles.shiftTrigger, {
                    [styles.shiftTriggerActive]: shiftActive,
                  })}
                  onClick={() => setShiftActive((active) => !active)}
                  disabled={paused}
                  aria-pressed={shiftActive}
                >
                  {shiftActive ? "Cancel shift" : "Use grid shift"}
                </button>
                <p className={styles.shiftControlsHint}>
                  {shiftActive
                    ? "Pick a direction around the board (uses your turn)."
                    : "Slide the whole grid one cell (uses your turn)."}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {gameOver && <p className={styles.nextGame}>Next game starting…</p>}

      {actionError && <p className={styles.actionError}>{actionError}</p>}

      <Scoreboard scores={room.scores} xLabel={xLabel} oLabel={oLabel} />
    </div>
  );
};

export default RoomGame;
