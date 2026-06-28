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
import { useRoomStream } from "@/lib/useRoomStream";
import { useStepCue } from "@/lib/useStepCue";
import { AI_SEAT } from "@/constants/game";
import { SHIFT_SLIDE_MS } from "@/constants/animation";
import {
  boardAfterActions,
  DEFAULT_SHIFT_MODE,
  shiftBoard,
} from "@/utils/gameLogic";
import type { Direction, Player } from "@/utils/gameLogic";
import type { RoomView } from "@/lib/roomTypes";
import Board, { type BoardTransition } from "@/common/components/Board";
import BoardHistory from "@/common/components/BoardHistory";
import RoomHeader from "@/common/components/RoomHeader";
import RoomNotFound, { RoomLoading } from "@/common/components/RoomMessage";
import Status, {
  type StatusInfo,
  playerTone,
  spectatorStatus,
} from "@/common/components/Status";
import Scoreboard from "@/common/components/Scoreboard";
import ShiftDebug from "@/common/components/ShiftDebug";
import styles from "./styles.module.scss";

/** Dev-only: surfaces the shift-animation tuning panel. Compiled out of
 *  production by the bundler's dead-code elimination on this constant. */
const SHIFT_DEBUG_ENABLED = process.env.NODE_ENV === "development";

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

/**
 * Polling cadence when the live SSE stream is connected. Updates arrive pushed
 * over the stream, so polling stays on only as a slow safety net (e.g. to
 * recover a missed event), not the primary update path.
 */
const FALLBACK_POLL_MS = 10000;

/**
 * Polling cadence when the stream is unavailable. Matches the pre-SSE interval
 * so behaviour degrades gracefully to plain polling if SSE can't connect.
 */
const ACTIVE_POLL_MS = 1500;

const SHIFT_ANIMATION_MS = SHIFT_SLIDE_MS;

/**
 * Beat held after O's shift slide settles before the AI's reply is revealed, so
 * the move reads as a distinct, deliberate turn rather than landing on the tail
 * of the slide. Added on top of {@link SHIFT_ANIMATION_MS}.
 */
const AI_SHIFT_REPLY_DELAY_MS = 500;

/**
 * How long the "new round" banner stays on screen after a reset before fading
 * out. Matches the total of its CSS pop-in/hold/fade-out animation.
 */
const ROUND_ANNOUNCEMENT_MS = Number(styles.roundAnnouncementMs);

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
  // Dev-only shift-animation tuning panel visibility.
  const [shiftDebugOpen, setShiftDebugOpen] = useState(false);
  // Whether O has armed the grid shift and is now picking a direction. The
  // direction buttons are mounted whenever O can shift but hidden (opacity: 0)
  // at rest so cancelling can reverse the fade-in before the board grows back.
  const [shiftActive, setShiftActive] = useState(false);

  const roomKey = useMemo(
    () => ["room", props.id, playerId] as const,
    [props.id, playerId],
  );

  // Imperatively replace the cached room (optimistic and authoritative writes).
  const setRoom = useCallback(
    (value: RoomView) => queryClient.setQueryData(roomKey, value),
    [queryClient, roomKey],
  );

  // Subscribe to the room's server-pushed updates. While a local write is in
  // flight (paused) we drop stream events for the same reason polling pauses: a
  // pushed snapshot must not clobber the optimistic/authoritative state. On the
  // room disappearing, refetch so the not-found UI surfaces promptly instead of
  // waiting for the next slow poll.
  const streamConnected = useRoomStream(props.id, playerId, {
    onRoom: (incoming) => {
      if (!paused) setRoom(incoming);
    },
    onGone: () => queryClient.invalidateQueries({ queryKey: roomKey }),
  });

  // Live updates arrive over SSE; polling stays on as a fallback - slow while
  // the stream is connected, at the original cadence when it isn't - and is
  // suspended entirely during a local write.
  const { data: room, error } = useQuery<RoomView>({
    queryKey: roomKey,
    queryFn: ({ signal }) =>
      fetchRoom(props.id, streamConnected ? null : playerId, signal),
    refetchInterval: paused
      ? false
      : streamConnected
        ? FALLBACK_POLL_MS
        : ACTIVE_POLL_MS,
  });

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

  // When O shifts against the AI, the server resolves O's shift and the AI's
  // reply in a single response. We want the slide to play out to rest before the
  // AI's mark appears, so in that case we first render the post-shift board (which
  // drives the animation) and only reveal the AI's move once the slide has
  // settled. Holding `paused` across the delay keeps a stream push or stray poll
  // from surfacing the AI move early.
  const shiftRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (shiftRevealTimerRef.current) clearTimeout(shiftRevealTimerRef.current);
    },
    [],
  );

  const shiftMutation = useMutation({
    mutationFn: (direction: Direction) =>
      shiftRoom(props.id, playerId as string, direction),
    onMutate: async (_direction: Direction) => {
      await beginWrite();
      return { snapshot: queryClient.getQueryData<RoomView>(roomKey) };
    },
    onSuccess: (updated: RoomView, direction: Direction, context) => {
      const snapshot = context?.snapshot;
      const { actions } = updated;
      const aiReply = actions[actions.length - 1];
      const shift = actions[actions.length - 2];
      // Defer only when the AI actually replied to the shift - its placement is
      // the latest action, sitting right after O's shift. A shift that ended the
      // game (or a two-player room) has no AI reply, so it renders at once and
      // animates as before.
      if (snapshot && shift?.kind === "shift" && aiReply?.kind === "place") {
        setRoom({
          ...snapshot,
          board: shiftBoard(
            snapshot.board,
            direction,
            shift.mode ?? DEFAULT_SHIFT_MODE,
          ),
          actions: actions.slice(0, -1), // up to and including the shift
          xIsNext: true,
          oShiftUsed: true,
        });
        shiftRevealTimerRef.current = setTimeout(() => {
          shiftRevealTimerRef.current = null;
          setRoom(updated); // reveal the AI's move now that the slide has settled
          setPaused(false);
        }, SHIFT_ANIMATION_MS + AI_SHIFT_REPLY_DELAY_MS);
        return;
      }
      setRoom(updated);
      setPaused(false);
    },
    onError: (err: unknown, _direction: Direction, context) => {
      if (context?.snapshot) setRoom(context.snapshot);
      setActionError(roomErrorMessage(err, "Could not shift the grid."));
      setPaused(false);
    },
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

  // Derive the board's shift-animation cue during render - not in an effect - so
  // the post-shift board and its cue reach <Board> in the same render (an effect
  // lands a render late: <Board> would see the new board with no cue, snap the
  // swept marks away, and have nothing left to animate off - the departing-marks
  // bug). The ordered action log is the one signal that fires for every client -
  // the shifting player, the opponent, and spectators alike - so we watch it grow
  // and build a cue when the newest action is a shift, reading the pre-shift board
  // so <Board> can slide each mark to where it settles and sweep the departing
  // marks off the grid. Any other change (a placement, or a shrink from a
  // reset/rewind) reports no cue, so the board snaps. useStepCue holds the cue's
  // identity stable across later renders so the slide fires exactly once.
  const actionCount = room?.actions.length ?? null;
  const boardTransition = useStepCue<BoardTransition>(actionCount, (count, prev) => {
    if (!room || prev === null || count <= prev) return null;
    const latest = room.actions[count - 1];
    if (latest?.kind !== "shift") return null;
    return {
      kind: "shift",
      direction: latest.dir,
      mode: latest.mode ?? DEFAULT_SHIFT_MODE,
      from: boardAfterActions(room.actions, count - 1, room.size),
    };
  });

  // Announce the start of each new round. A reset swaps the two players' seats
  // (see resetGame), so the seat I now hold tells me whether I move first (X) or
  // second (O). The action log emptying after a played-out game is the signal a
  // round just began - it fires for both players alike. We capture the new seat
  // (read live via a ref so the effect can depend only on the count) and flash a
  // banner with it. The ref seeds on first load so joining mid-game doesn't flash
  // it, and only a shrink from a non-empty log counts, so the opening round - which
  // has no swap to announce - stays silent.
  const [roundAnnouncement, setRoundAnnouncement] = useState<Player | null>(null);
  const mySeatRef = useRef(mySeat);
  mySeatRef.current = mySeat;
  const prevRoundActionsRef = useRef<number | null>(null);
  useEffect(() => {
    if (actionCount === null) return;
    const prev = prevRoundActionsRef.current;
    prevRoundActionsRef.current = actionCount;
    if (prev !== null && prev > 0 && actionCount === 0 && mySeatRef.current) {
      setRoundAnnouncement(mySeatRef.current);
    }
  }, [actionCount]);

  // Retire the banner once its animation has played out.
  useEffect(() => {
    if (!roundAnnouncement) return;
    const timer = setTimeout(
      () => setRoundAnnouncement(null),
      ROUND_ANNOUNCEMENT_MS,
    );
    return () => clearTimeout(timer);
  }, [roundAnnouncement]);

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
  const seatLabel = (seat: Player): string => {
    if (room.seats[seat] === AI_SEAT) return `AI (${seat})`;
    if (mySeat === seat) return `You (${seat})`;
    return `Player ${seat}`;
  };
  const xLabel = seatLabel("X");
  const oLabel = seatLabel("O");

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

  // While the shift picker is armed the cells are inert (and show no hover): the
  // turn is spent on a direction, not a placement.
  const boardDisabled =
    gameOver ||
    mySeat === null ||
    currentTurn !== mySeat ||
    paused ||
    shiftActive;
  const turnActive = (seat: Player) => !gameOver && currentTurn === seat;

  return (
    <div className={styles.root}>
      {SHIFT_DEBUG_ENABLED && (
        <>
          <button
            type="button"
            className={styles.shiftDebugToggle}
            onClick={() => setShiftDebugOpen((open) => !open)}
          >
            Shift debug
          </button>
          {shiftDebugOpen && (
            <ShiftDebug onClose={() => setShiftDebugOpen(false)} />
          )}
        </>
      )}

      {roundAnnouncement && (
        <div
          key={roundAnnouncement}
          className={styles.roundBanner}
          role="status"
          aria-live="polite"
        >
          <span className={styles.roundBannerKicker}>New round</span>
          <span
            className={classNames(styles.roundBannerSeat, {
              [styles.roundBannerSeatX]: roundAnnouncement === "X",
              [styles.roundBannerSeatO]: roundAnnouncement === "O",
            })}
          >
            {roundAnnouncement === "X"
              ? "You're going first — X"
              : "You're going second — O"}
          </span>
        </div>
      )}

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
          <BoardHistory
            actions={room.actions}
            size={room.size}
            winLength={room.winLength}
          />
        </div>

        {/* At rest the board fills the whole frame. Arming the picker scales the
            board down (`.boardFrameArmed`) and the arrows fade into the freed
            band once the shrink settles. The arrows stay mounted while O can
            shift so cancelling can reverse the sequence (fade out, then grow).
            See styles.module.scss for the two-phase transition timing. */}
        <div
          className={classNames(styles.boardFrame, {
            [styles.boardFrameArmed]: shiftActive,
          })}
        >
          {canShiftNow &&
            SHIFT_OPTIONS.map(({ dir, glyph, label, slotClass }) => (
              <button
                key={dir}
                type="button"
                className={classNames(styles.shiftButton, styles[slotClass], {
                  [styles.shiftButtonVisible]: shiftActive,
                })}
                onClick={() => handleShift(dir)}
                disabled={paused}
                aria-label={label}
                title={label}
                aria-hidden={!shiftActive}
                tabIndex={shiftActive ? undefined : -1}
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
              transition={boardTransition}
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

      {gameOver && (
        <div className={styles.nextGame}>
          <p className={styles.nextGameLabel}>Next game starting…</p>
          {/* Countdown bar shrinking from full width to 0 over the same delay
              that schedules the auto-reset, so the wait reads as a visible
              timer. Duration comes from AUTO_RESET_MS so the two never drift. */}
          <div className={styles.countdownTrack} aria-hidden="true">
            <div
              className={styles.countdownBar}
              style={{
                animationDuration: `${AUTO_RESET_MS}ms`,
                animationDelay: `${-Math.min(Date.now() - room.lastActivity, AUTO_RESET_MS)}ms`,
              }}
            />
          </div>
        </div>
      )}

      {actionError && <p className={styles.actionError}>{actionError}</p>}

      <Scoreboard scores={room.scores} xLabel={xLabel} oLabel={oLabel} />
    </div>
  );
};

export default RoomGame;
