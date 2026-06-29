"use client";

import { useState } from "react";
import classNames from "classnames";
import { canXShift } from "@/utils/gameLogic";
import type { Direction, Player } from "@/utils/gameLogic";
import { AI_SEAT } from "@/constants/game";
import { AUTO_RESET_MS } from "@/constants/game";
import { useRoom } from "@/lib/useRoom";
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

type Props = {
  id: string;
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
 * How long the "new round" banner stays on screen after a reset before fading
 * out. Matches the total of its CSS pop-in/hold/fade-out animation. Read from
 * the stylesheet `:export` and handed to {@link useRoom}, keeping scss the
 * single source of truth for the banner duration.
 */
const ROUND_ANNOUNCEMENT_MS = Number(styles.roundAnnouncementMs);

const RoomGame = (props: Props) => {
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
  } = useRoom(props.id, { roundAnnouncementMs: ROUND_ANNOUNCEMENT_MS });

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

  const turnActive = (seat: Player) => !gameOver && currentTurn === seat;

  // X's shift is conditional, so it shows three states; only meaningful once the
  // board is larger than 3x3 (on 3x3 X never earns a shift). O's is always its
  // ability, so it only ever reads used/available.
  const xShiftLabel = room.xShiftUsed
    ? "used"
    : canXShift({ size: room.size, turn: room.actions.length })
      ? "available"
      : "locked";

  // The "use grid shift" trigger + hint. Rendered in the viewer's own info row
  // (gated by canShiftNow, which is already seat- and turn-specific), so exactly
  // one row shows it. Shared by both seats since X's and O's shift arm the same way.
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
        {shiftActive ? "Cancel shift" : "Use grid shift"}
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
          {/* Always available: copies a shareable link to this room so the
              player can hand it to someone to join (or spectate). Sits at the
              top of the player column, above the seat info. */}
          <InviteButton roomId={props.id} />

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
                Grid shift: {xShiftLabel}
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
              Grid shift: {room.oShiftUsed ? "used" : "available"}
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

export default RoomGame;
