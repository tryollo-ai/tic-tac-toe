"use client";

import { useState } from "react";
import classNames from "classnames";
import { canXShift } from "@/utils/gameLogic";
import type { Direction, Player } from "@/utils/gameLogic";
import { AI_SEAT, AUTO_RESET_MS } from "@/constants/game";
import type { UseRoomResult } from "@/lib/useRoom";
import Board from "@/common/components/Board";
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
 * The four trick directions. Each renders as a single arrow on the matching
 * edge of the board (`slotClass`), with a spelled-out label for assistive tech.
 */
const SHIFT_OPTIONS: {
  dir: Direction;
  glyph: string;
  label: string;
  slotClass: "shiftSlotTop" | "shiftSlotBottom" | "shiftSlotLeft" | "shiftSlotRight";
}[] = [
  { dir: "top", glyph: "↑", label: "Trick up", slotClass: "shiftSlotTop" },
  { dir: "bottom", glyph: "↓", label: "Trick down", slotClass: "shiftSlotBottom" },
  { dir: "left", glyph: "←", label: "Trick left", slotClass: "shiftSlotLeft" },
  { dir: "right", glyph: "→", label: "Trick right", slotClass: "shiftSlotRight" },
];

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
  // Dev-only shift-animation tuning panel visibility. Kept in the component
  // because its visibility has no coupling to room data.
  const [shiftDebugOpen, setShiftDebugOpen] = useState(false);

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
  const xLabel = seatLabel("X");
  const oLabel = seatLabel("O");

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

  const turnActive = (seat: Player) => !gameOver && currentTurn === seat;

  // X's trick is conditional, so it shows three states; only meaningful once the
  // board is larger than 3x3 (on 3x3 X never earns a trick). O's is always its
  // ability, so it only ever reads used/available.
  const xShiftLabel = room.xShiftUsed
    ? "used"
    : canXShift({ size: room.size, turn: room.actions.length })
      ? "available"
      : "locked";

  // The "use trick" trigger + hint. Rendered in the viewer's own info row
  // (gated by canShiftNow, which is already seat- and turn-specific), so exactly
  // one row shows it. Shared by both seats since X's and O's trick arm the same way.
  const shiftControls = (
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
        {shiftActive ? "Cancel trick" : "Use trick"}
      </button>
      <p className={styles.shiftControlsHint}>
        {shiftActive
          ? "Pick a direction around the board (uses your turn)."
          : "Slide the whole grid one cell (uses your turn)."}
      </p>
    </div>
  );

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

      {/* A local pass-and-play game auto-seats and plays immediately, so it has
          no seat bar. Online rooms and vs-AI games show seat controls: claim a
          side (vs-AI: "pick a mark"), leave it, or spectate a full room. */}
      {!isLocal && (
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
      )}

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
          {props.showInvite && props.roomId && (
            // Always available in an online room: copies a shareable link to
            // this room. Local/AI games are single-device and not shareable, so
            // they omit it.
            <InviteButton roomId={props.roomId} />
          )}

          <span className={styles.winCondition}>
            {room.winLength} in a row
          </span>

          <div
            className={classNames(styles.infoRow, {
              [styles.infoRowActive]: turnActive("X"),
            })}
          >
            <span className={classNames(styles.infoName, styles.infoNameX)}>
              {xLabel}
            </span>
            {room.size > 3 ? (
              <span
                className={classNames(styles.shiftStatus, {
                  [styles.shiftStatusUsed]: room.xShiftUsed,
                })}
              >
                Trick: {xShiftLabel}
              </span>
            ) : (
              <span className={styles.infoAbility}>Moves first</span>
            )}

            {canShiftNow && mySeat === "X" && shiftControls}
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
              Trick: {room.oShiftUsed ? "used" : "available"}
            </span>

            {canShiftNow && mySeat === "O" && shiftControls}
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

export default GameView;
