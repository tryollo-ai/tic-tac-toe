"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  claimSeat,
  fetchRoom,
  leaveSeat,
  makeMove,
  RoomError,
  roomErrorCode,
  shiftRoom,
} from "@/utils/roomClient";
import { usePlayerId } from "@/lib/usePlayerId";
import { useRoomStream } from "@/lib/useRoomStream";
import { useStepCue } from "@/lib/useStepCue";
import { AUTO_RESET_MS } from "@/constants/game";
import { SHIFT_SLIDE_MS } from "@/constants/animation";
import {
  boardAfterActions,
  canXShift,
  DEFAULT_SHIFT_MODE,
  shiftBoard,
} from "@/utils/gameLogic";
import type { Direction, Player } from "@/utils/gameLogic";
import type { RoomView } from "@/lib/roomTypes";
import type { BoardTransition } from "@/common/components/Board";

/** User-facing copy for the room error codes the UI can surface. */
const ROOM_ERROR_MESSAGES: Record<string, string> = {
  "not-your-turn": "It is not your turn.",
  "cell-taken": "That cell is already taken.",
  "game-over": "The game is already over.",
  "seat-taken": "That seat was just taken.",
  "not-participant": "Only a seated player can do that.",
  "shift-used": "You have already used your shift.",
  "shift-unavailable": "Your grid shift isn't available yet.",
};

/** Map a thrown error to a known room-error message, or the given fallback. */
function roomErrorMessage(err: unknown, fallback: string): string {
  return ROOM_ERROR_MESSAGES[roomErrorCode(err)] ?? fallback;
}

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

/** Tunables the hook reads from its caller, decoupling it from any stylesheet. */
type UseRoomOptions = {
  /**
   * How long the "new round" banner stays on screen after a reset before fading
   * out. Sourced from the component's scss `:export` so the stylesheet stays the
   * single source of truth and this `lib/` hook imports no component styles.
   */
  roundAnnouncementMs: number;
};

/**
 * Everything `RoomGame` needs to render a live room: the room view and its load
 * state, defensively-derived game state, the action handlers, and the transient
 * UI surfaces (errors, the round banner, the board-shift cue). All room-
 * management state, effects, and mutations live behind this one interface so the
 * component is left with presentation.
 */
export type UseRoomResult = {
  // Room data & load state
  room: RoomView | undefined;
  error: unknown;
  notFound: boolean;
  streamConnected: boolean;

  // Derived game state (defensive; meaningful once `room` is set)
  mySeat: Player | null;
  currentTurn: Player;
  gameOver: boolean;
  canShiftNow: boolean;
  boardDisabled: boolean;
  paused: boolean;

  // Action handlers
  handleMove: (index: number) => void;
  handleClaim: (seat: Player) => void;
  handleLeave: () => void;
  handleShift: (direction: Direction) => void;

  // Shift-picker UI state
  shiftActive: boolean;
  setShiftActive: Dispatch<SetStateAction<boolean>>;

  // Transient UI surfaces
  actionError: string | null;
  roundAnnouncement: Player | null;
  boardTransition: BoardTransition | null;
};

/**
 * Drive a live multiplayer room: subscribe to its SSE stream (falling back to
 * polling), expose the authoritative room view, and own every mutation
 * (move/claim/leave/shift) along with their optimistic updates, shift-reveal
 * timing, seat release, the server-driven next-round nudge, and the new-round
 * announcement.
 *
 * `playerId` is read internally via {@link usePlayerId} and never surfaced; the
 * caller passes only the room `id` and a few presentation tunables.
 */
export function useRoom(id: string, opts: UseRoomOptions): UseRoomResult {
  const playerId = usePlayerId();
  const queryClient = useQueryClient();
  // Polling pauses while a local write is in flight so a stale GET can't clobber
  // the optimistic/authoritative state.
  const [paused, setPaused] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Whether O has armed the grid shift and is now picking a direction. The
  // direction buttons are mounted whenever O can shift but hidden (opacity: 0)
  // at rest so cancelling can reverse the fade-in before the board grows back.
  const [shiftActive, setShiftActive] = useState(false);

  const roomKey = useMemo(
    () => ["room", id, playerId] as const,
    [id, playerId],
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
  const streamConnected = useRoomStream(id, playerId, {
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
      fetchRoom(id, streamConnected ? null : playerId, signal),
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
    const holdsX = room.seats.X === playerId;
    const holdsO = room.seats.O === playerId;
    // Same-device (local) play: one player holds both seats and moves for each
    // side in turn, so the seat they are acting as is simply whoever is on turn.
    // Every consumer (board enablement, optimistic mark, shift ownership) keys
    // off mySeat, so tracking the on-turn seat makes pass-and-play just work.
    if (holdsX && holdsO) return room.xIsNext ? "X" : "O";
    if (holdsX) return "X";
    if (holdsO) return "O";
    return null;
  }, [room, playerId]);

  // Whether this player holds any seat in the room. Unlike `mySeat` - which in a
  // local room tracks the on-turn side and so flips X<->O every turn - this stays
  // stable while seated, so effects keyed on "am I seated" (seat release) don't
  // re-fire on every turn.
  const amSeated =
    !!room &&
    !!playerId &&
    (room.seats.X === playerId || room.seats.O === playerId);

  // Pause polling and abort any in-flight GET before a local write begins, so a
  // stale response can't land after our optimistic/authoritative update.
  const beginWrite = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: roomKey });
    setPaused(true);
    setActionError(null);
  }, [queryClient, roomKey]);

  // Shared lifecycle for the non-optimistic writes (claim/leave/shift):
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
      makeMove(id, playerId as string, index),
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
    mutationFn: (seat: Player) => claimSeat(id, playerId as string, seat),
    ...writeOptions("Could not claim that seat."),
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveSeat(id, playerId as string),
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
      shiftRoom(id, playerId as string, direction),
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
          // The shift consumed the viewer's whole turn, so play passes to the
          // other side, and the matching seat's one-time shift is now spent.
          xIsNext: mySeat === "O",
          oShiftUsed: mySeat === "O" ? true : snapshot.oShiftUsed,
          xShiftUsed: mySeat === "X" ? true : snapshot.xShiftUsed,
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

  // Best-effort instant seat release: on tab close via `pagehide`, and on
  // in-app navigation (unmount) via the cleanup. The latest seat/player is read
  // through a ref so this effect mounts only once and its cleanup runs solely on
  // a real unmount. Keeping `mySeat` out of the deps is essential: `mySeat`
  // flips X<->O whenever the on-turn side changes - between rounds via a seat
  // swap (see swapSeats), and every turn in a local pass-and-play room - and if
  // that re-ran the effect its cleanup `release()` would fire a stray DELETE and
  // boot the player from a seat they actually kept. The 30s TTL is the backstop.
  const releaseSeatRef = useRef<() => void>(() => {});
  releaseSeatRef.current = () => {
    if (!playerId || !mySeat) return;
    fetch(`/api/rooms/${id}/seat`, {
      method: "DELETE",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    }).catch(() => {});
  };
  useEffect(() => {
    const release = () => releaseSeatRef.current();
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, []);

  const currentTurn: Player = room?.xIsNext ? "X" : "O";
  const gameOver = room?.status === "finished";

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

  // The next round is reset server-side (the store's lazy `maybeStartNextRound`
  // fires once the finished board has been on screen for AUTO_RESET_MS, driven
  // by any connected client's per-second stream heartbeat). To keep the reset
  // landing crisply at the moment the countdown bar empties - rather than up to
  // a stream tick (~1s) later - a seated client fires a one-shot GET after the
  // remaining delay. That GET runs `getRoom(id, playerId)`, which re-evaluates
  // the server-side guard; the client only asks the server to decide, so
  // authority stays on the server and the nudge is idempotent and harmless if
  // the room has already reset. Gated on `amSeated` so spectators don't all nudge
  // at once - they are covered by the 1s stream tick.
  useEffect(() => {
    if (room?.status !== "finished" || !playerId || !amSeated) return;
    const elapsed = Date.now() - room.lastActivity;
    const remaining = Math.max(0, AUTO_RESET_MS - elapsed);
    const timer = setTimeout(() => {
      fetchRoom(id, playerId)
        .then(setRoom)
        .catch(() => {});
    }, remaining);
    return () => clearTimeout(timer);
  }, [room?.status, room?.lastActivity, id, amSeated, playerId, setRoom]);

  // Disarm the shift picker whenever the viewer can no longer shift (turn passed,
  // shift spent or not yet earned, game ended, seat left), so it never lingers
  // into the next turn. O may always spend its one-time shift on its turn; X's is
  // classic-only and gated by canXShift (larger boards, once the game is underway).
  const myTurn =
    !!room &&
    room.status !== "finished" &&
    mySeat != null &&
    currentTurn === mySeat;
  const canShiftNow =
    myTurn &&
    (mySeat === "O"
      ? !room!.oShiftUsed
      : !room!.xShiftUsed &&
        canXShift({ size: room!.size, turn: room!.actions.length }));
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
  // (see swapSeats), so the seat I now hold tells me whether I move first (X) or
  // second (O). The action log emptying after a played-out game is the signal a
  // round just began - it fires for both players alike. We capture the new seat
  // (read live via a ref so the effect can depend only on the count) and flash a
  // banner with it. The ref seeds on first load so joining mid-game doesn't flash
  // it, and only a shrink from a non-empty log counts, so the opening round - which
  // has no swap to announce - stays silent. Local same-device rooms never swap
  // seats (one player plays both sides), so there is no first/second to announce.
  const [roundAnnouncement, setRoundAnnouncement] = useState<Player | null>(null);
  const mySeatRef = useRef(mySeat);
  mySeatRef.current = mySeat;
  const isLocalRef = useRef(room?.mode === "local");
  isLocalRef.current = room?.mode === "local";
  const prevRoundActionsRef = useRef<number | null>(null);
  useEffect(() => {
    if (actionCount === null) return;
    const prev = prevRoundActionsRef.current;
    prevRoundActionsRef.current = actionCount;
    if (
      prev !== null &&
      prev > 0 &&
      actionCount === 0 &&
      mySeatRef.current &&
      !isLocalRef.current
    ) {
      setRoundAnnouncement(mySeatRef.current);
    }
  }, [actionCount]);

  // Retire the banner once its animation has played out.
  useEffect(() => {
    if (!roundAnnouncement) return;
    const timer = setTimeout(
      () => setRoundAnnouncement(null),
      opts.roundAnnouncementMs,
    );
    return () => clearTimeout(timer);
  }, [roundAnnouncement, opts.roundAnnouncementMs]);

  // While the shift picker is armed the cells are inert (and show no hover): the
  // turn is spent on a direction, not a placement.
  const boardDisabled =
    gameOver ||
    mySeat === null ||
    currentTurn !== mySeat ||
    paused ||
    shiftActive;

  return {
    room,
    error,
    notFound,
    streamConnected,

    mySeat,
    currentTurn,
    gameOver,
    canShiftNow,
    boardDisabled,
    paused,

    handleMove,
    handleClaim,
    handleLeave,
    handleShift,

    shiftActive,
    setShiftActive,

    actionError,
    roundAnnouncement,
    boardTransition,
  };
}
