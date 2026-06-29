"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import classNames from "classnames";
import { canXShift } from "@/utils/gameLogic";
import type { Board as BoardState, Direction, Player } from "@/utils/gameLogic";
import { AI_SEAT, AUTO_RESET_MS } from "@/constants/game";
import type { UseRoomResult } from "@/lib/useRoom";
import Board, { type BoardTransition } from "@/common/components/Board";
import BoardHistory from "@/common/components/BoardHistory";
import InviteButton from "@/common/components/InviteButton";
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
 * The "new round" banner shown when seats swap between games, announcing which
 * mark the local player now holds. Self-announcing via `role="status"`; the
 * `key` on the caller remounts it each round so the entrance animation replays.
 */
const RoundBanner = (props: { seat: Player }) => (
  <div className={styles.roundBanner} role="status" aria-live="polite">
    <span className={styles.roundBannerKicker}>New round</span>
    <span
      className={classNames(styles.roundBannerSeat, {
        [styles.roundBannerSeatX]: props.seat === "X",
        [styles.roundBannerSeatO]: props.seat === "O",
      })}
    >
      {props.seat === "X"
        ? "You're going first — X"
        : "You're going second — O"}
    </span>
  </div>
);

/**
 * The post-game "next game starting…" notice with a countdown bar that shrinks
 * from full width to 0 over {@link AUTO_RESET_MS}, the same delay that schedules
 * the auto-reset, so the wait reads as a visible timer. The negative
 * `animationDelay` fast-forwards the bar to match time already elapsed since
 * `lastActivity`, keeping spectators who join mid-countdown in sync.
 */
const NextGameCountdown = (props: { lastActivity: number }) => (
  <div className={styles.nextGame}>
    <p className={styles.nextGameLabel}>Next game starting…</p>
    <div className={styles.countdownTrack} aria-hidden="true">
      <div
        className={styles.countdownBar}
        style={{
          animationDuration: `${AUTO_RESET_MS}ms`,
          animationDelay: `${-Math.min(Date.now() - props.lastActivity, AUTO_RESET_MS)}ms`,
        }}
      />
    </div>
  </div>
);

/**
 * The seat controls for online and vs-AI rooms (local pass-and-play auto-seats
 * and renders no bar). A seated player gets a leave button; an unseated one gets
 * a claim button per open side, or a "Spectating" badge when the room is full.
 */
const SeatBar = (props: {
  mySeat: Player | null;
  seats: { X: string | null; O: string | null };
  paused: boolean;
  onClaim: (seat: Player) => void;
  onLeave: () => void;
}) => (
  <div className={styles.seatBar}>
    {props.mySeat ? (
      <button
        type="button"
        className={classNames(styles.seatButton, styles.leaveButton)}
        onClick={props.onLeave}
        disabled={props.paused}
      >
        Leave seat
      </button>
    ) : (
      <>
        {props.seats.X === null && (
          <button
            type="button"
            className={styles.seatButton}
            onClick={() => props.onClaim("X")}
            disabled={props.paused}
          >
            Play as X
          </button>
        )}
        {props.seats.O === null && (
          <button
            type="button"
            className={styles.seatButton}
            onClick={() => props.onClaim("O")}
            disabled={props.paused}
          >
            Play as O
          </button>
        )}
        {props.seats.X !== null && props.seats.O !== null && (
          <span className={styles.spectateBadge}>Spectating</span>
        )}
      </>
    )}
  </div>
);

/**
 * The right-hand info panel: invite control, win condition, and a status row per
 * seat showing the player's label, grid-shift availability, and - in the seat the
 * local player holds while a shift is armed - the use-grid-shift trigger. Pure
 * presentation; every value and handler arrives via props.
 */
const InfoPanel = (props: {
  showInvite?: boolean;
  roomId?: string;
  winLength: number;
  xLabel: string;
  oLabel: string;
  xActive: boolean;
  oActive: boolean;
  size: number;
  xShiftUsed: boolean;
  oShiftUsed: boolean;
  xShiftLabel: string;
  canShiftNow: boolean;
  mySeat: Player | null;
  shiftActive: boolean;
  setShiftActive: Dispatch<SetStateAction<boolean>>;
  paused: boolean;
}) => {
  // The "use grid shift" trigger + hint. Rendered in the seat row the local
  // player holds (gated by canShiftNow, which is already seat- and turn-specific),
  // so exactly one row shows it. Shared by both seats since X's and O's shift arm
  // the same way.
  const shiftControls = (
    <div className={styles.shiftControls}>
      <button
        type="button"
        className={classNames(styles.shiftTrigger, {
          [styles.shiftTriggerActive]: props.shiftActive,
        })}
        onClick={() => props.setShiftActive((active) => !active)}
        disabled={props.paused}
        aria-pressed={props.shiftActive}
      >
        {props.shiftActive ? "Cancel shift" : "Use grid shift"}
      </button>
      <p className={styles.shiftControlsHint}>
        {props.shiftActive
          ? "Pick a direction around the board (uses your turn)."
          : "Slide the whole grid one cell (uses your turn)."}
      </p>
    </div>
  );

  return (
    <aside className={styles.infoPanel}>
      {props.showInvite && props.roomId && (
        // Always available in an online room: copies a shareable link to this
        // room. Local/AI games are single-device and not shareable, so they
        // omit it.
        <InviteButton roomId={props.roomId} />
      )}

      <span className={styles.winCondition}>{props.winLength} in a row</span>

      <div
        className={classNames(styles.infoRow, {
          [styles.infoRowActive]: props.xActive,
        })}
      >
        <span className={classNames(styles.infoName, styles.infoNameX)}>
          {props.xLabel}
        </span>
        {props.size > 3 ? (
          <span
            className={classNames(styles.shiftStatus, {
              [styles.shiftStatusUsed]: props.xShiftUsed,
            })}
          >
            Grid shift: {props.xShiftLabel}
          </span>
        ) : (
          <span className={styles.infoAbility}>Moves first</span>
        )}

        {props.canShiftNow && props.mySeat === "X" && shiftControls}
      </div>

      <div
        className={classNames(styles.infoRow, {
          [styles.infoRowActive]: props.oActive,
        })}
      >
        <span className={classNames(styles.infoName, styles.infoNameO)}>
          {props.oLabel}
        </span>
        <span
          className={classNames(styles.shiftStatus, {
            [styles.shiftStatusUsed]: props.oShiftUsed,
          })}
        >
          Grid shift: {props.oShiftUsed ? "used" : "available"}
        </span>

        {props.canShiftNow && props.mySeat === "O" && shiftControls}
      </div>
    </aside>
  );
};

/**
 * The board and its grid-shift arrows. At rest the board fills the whole frame;
 * arming the picker (`shiftActive`) scales it down and fades the four edge arrows
 * into the freed band. The arrows stay mounted while the local player may shift
 * (`canShiftNow`) so cancelling can reverse the sequence. Pure presentation - the
 * board state and every handler arrive via props.
 */
const BoardFrame = (props: {
  shiftActive: boolean;
  canShiftNow: boolean;
  paused: boolean;
  onShift: (dir: Direction) => void;
  board: BoardState;
  winningLine: readonly number[] | null;
  onSquareClick: (index: number) => void;
  boardDisabled: boolean;
  transition?: BoardTransition | null;
}) => (
  // See styles.module.scss for the two-phase (shrink, then fade) transition timing.
  <div
    className={classNames(styles.boardFrame, {
      [styles.boardFrameArmed]: props.shiftActive,
    })}
  >
    {props.canShiftNow &&
      SHIFT_OPTIONS.map(({ dir, glyph, label, slotClass }) => (
        <button
          key={dir}
          type="button"
          className={classNames(styles.shiftButton, styles[slotClass], {
            [styles.shiftButtonVisible]: props.shiftActive,
          })}
          onClick={() => props.onShift(dir)}
          disabled={props.paused}
          aria-label={label}
          title={label}
          aria-hidden={!props.shiftActive}
          tabIndex={props.shiftActive ? undefined : -1}
        >
          {glyph}
        </button>
      ))}

    <div className={styles.boardSlot}>
      <Board
        board={props.board}
        winningLine={props.winningLine}
        onSquareClick={props.onSquareClick}
        disabled={props.boardDisabled}
        transition={props.transition}
      />
    </div>
  </div>
);

/**
 * The dev-only shift-animation tuning panel and its toggle. Owns its own
 * open/closed state since visibility has no coupling to room data; compiled out
 * of production by the bundler's dead-code elimination on {@link SHIFT_DEBUG_ENABLED}.
 */
const ShiftDebugPanel = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.shiftDebugToggle}
        onClick={() => setOpen((o) => !o)}
      >
        Shift debug
      </button>
      {open && <ShiftDebug onClose={() => setOpen(false)} />}
    </>
  );
};

/**
 * Derives the render-ready view-model for a loaded game from the room state and
 * the local player's seat/turn context. Pure - it groups the seat labels, status
 * line, per-seat turn highlight, and X's three-state shift label so the main
 * component's body stays early-returns + JSX with no inline derivation.
 */
const deriveGameView = (args: {
  room: NonNullable<UseRoomResult["room"]>;
  mySeat: Player | null;
  currentTurn: Player;
  gameOver: boolean;
}) => {
  const { room, mySeat, currentTurn, gameOver } = args;

  const winner: Player | null =
    gameOver && room.winningLine
      ? (room.board[room.winningLine[0]] as Player)
      : null;
  const bothSeated = room.seats.X !== null && room.seats.O !== null;
  // Same-device play: the one seated player controls both sides, so both seats
  // read "You" when seated; a spectator of a local room sees plain seat names.
  const isLocal = room.mode === "local";
  const isAi = room.mode === "ai";
  const seatLabel = (seat: Player): string => {
    if (room.seats[seat] === AI_SEAT) return `AI (${seat})`;
    if (isLocal) return mySeat ? `You (${seat})` : `Player ${seat}`;
    if (mySeat === seat) return `You (${seat})`;
    return `Player ${seat}`;
  };

  // Terminal and pure spectator states share their wording with the replay
  // viewer (spectatorStatus); only the seat-aware mid-game lines are bespoke.
  // "Your turn" is checked before the empty-seat case so a solo player who is on
  // turn (e.g. O after swapping seats) is prompted to act rather than told to
  // wait - mirroring canShiftNow, which also drops the bothSeated requirement.
  // A local room has no "opponent" - one player moves for both sides - so it
  // always reads the neutral, whose-turn-it-is status the spectator view uses.
  let status: StatusInfo;
  if (isLocal) {
    status = spectatorStatus(winner, currentTurn, gameOver);
  } else if (!gameOver && mySeat && currentTurn === mySeat) {
    status = { message: "Your turn", tone: playerTone(currentTurn) };
  } else if (!gameOver && !bothSeated) {
    // Before a seat is taken: a vs-AI game is waiting on the human to choose a
    // side; an online room is waiting on a second player to join.
    status = isAi
      ? { message: "Pick a mark", tone: "neutral" }
      : { message: "Waiting for opponent", tone: "neutral" };
  } else if (!gameOver && mySeat) {
    status = { message: "Opponent's turn", tone: playerTone(currentTurn) };
  } else {
    status = spectatorStatus(winner, currentTurn, gameOver);
  }

  // X's shift is conditional, so it shows three states; only meaningful once the
  // board is larger than 3x3 (on 3x3 X never earns a shift). O's is always its
  // ability, so it only ever reads used/available.
  const xShiftLabel = room.xShiftUsed
    ? "used"
    : canXShift({ size: room.size, turn: room.actions.length })
      ? "available"
      : "locked";

  return {
    xLabel: seatLabel("X"),
    oLabel: seatLabel("O"),
    isLocal,
    status,
    xActive: !gameOver && currentTurn === "X",
    oActive: !gameOver && currentTurn === "O",
    xShiftLabel,
  };
};

type Props = {
  /**
   * The driven game state. Both the online room ({@link useRoom}) and the
   * single-device game ({@link import("@/lib/useLocalGame").useLocalGame})
   * produce this same shape, so this view renders either unchanged.
   */
  game: UseRoomResult;
  /** Show the copy-a-room-link control (online rooms only - local/AI games are
   *  not shareable, so they pass false). */
  showInvite?: boolean;
  /** The room id the invite link points at; required when `showInvite`. */
  roomId?: string;
};

/**
 * The presentational game surface: board, history, info panel, scoreboard, and
 * the seat/shift controls. It owns no game logic - every value and handler comes
 * in via {@link Props.game} - so it renders an online room and a client-only
 * local/AI game identically, differing only in the invite control.
 */
const GameView = (props: Props) => {
  const {
    room,
    error,
    notFound,
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
  } = props.game;

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

  const { xLabel, oLabel, isLocal, status, xActive, oActive, xShiftLabel } =
    deriveGameView({ room, mySeat, currentTurn, gameOver });

  return (
    <div className={styles.root}>
      {SHIFT_DEBUG_ENABLED && <ShiftDebugPanel />}

      {roundAnnouncement && (
        <RoundBanner key={roundAnnouncement} seat={roundAnnouncement} />
      )}

      <RoomHeader name={room.name} mode={room.mode} />

      <Status message={status.message} tone={status.tone} />

      {/* A local pass-and-play game auto-seats and plays immediately, so it has
          no seat bar. Online rooms and vs-AI games show seat controls: claim a
          side (vs-AI: "pick a mark"), leave it, or spectate a full room. */}
      {!isLocal && (
        <SeatBar
          mySeat={mySeat}
          seats={room.seats}
          paused={paused}
          onClaim={handleClaim}
          onLeave={handleLeave}
        />
      )}

      <div className={styles.playArea}>
        <div className={styles.historySlot}>
          <BoardHistory
            actions={room.actions}
            size={room.size}
            winLength={room.winLength}
          />
        </div>

        <BoardFrame
          shiftActive={shiftActive}
          canShiftNow={canShiftNow}
          paused={paused}
          onShift={handleShift}
          board={room.board}
          winningLine={room.winningLine}
          onSquareClick={handleMove}
          boardDisabled={boardDisabled}
          transition={boardTransition}
        />

        <InfoPanel
          showInvite={props.showInvite}
          roomId={props.roomId}
          winLength={room.winLength}
          xLabel={xLabel}
          oLabel={oLabel}
          xActive={xActive}
          oActive={oActive}
          size={room.size}
          xShiftUsed={room.xShiftUsed}
          oShiftUsed={room.oShiftUsed}
          xShiftLabel={xShiftLabel}
          canShiftNow={canShiftNow}
          mySeat={mySeat}
          shiftActive={shiftActive}
          setShiftActive={setShiftActive}
          paused={paused}
        />
      </div>

      {gameOver && <NextGameCountdown lastActivity={room.lastActivity} />}

      {actionError && <p className={styles.actionError}>{actionError}</p>}

      <Scoreboard scores={room.scores} xLabel={xLabel} oLabel={oLabel} />
    </div>
  );
};

export default GameView;
