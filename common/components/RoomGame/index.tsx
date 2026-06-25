"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IoHelpCircleOutline } from "react-icons/io5";
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
import { usePolling } from "@/lib/usePolling";
import type { Direction, Player } from "@/utils/gameLogic";
import { modeLabel, type RoomView } from "@/lib/roomTypes";
import Board from "@/common/components/Board";
import Status, { type StatusTone, playerTone } from "@/common/components/Status";
import Scoreboard from "@/common/components/Scoreboard";
import UIDialog from "@/common/components/UIDialog";
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

/** The four grid-shift choices, in the order shown to player O. */
const SHIFT_OPTIONS: { dir: Direction; label: string }[] = [
  { dir: "top", label: "Shift up ↑" },
  { dir: "bottom", label: "Shift down ↓" },
  { dir: "left", label: "Shift left ←" },
  { dir: "right", label: "Shift right →" },
];

/** Map a thrown error to a known room-error message, or the given fallback. */
function roomErrorMessage(err: unknown, fallback: string): string {
  return ROOM_ERROR_MESSAGES[roomErrorCode(err)] ?? fallback;
}

const RoomGame = (props: Props) => {
  const playerId = usePlayerId();
  const [paused, setPaused] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shiftHelpOpen, setShiftHelpOpen] = useState(false);

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchRoom(props.id, playerId, signal),
    [props.id, playerId],
  );
  const { data: room, error, setData } = usePolling<RoomView>(
    fetcher,
    1500,
    paused,
  );

  const notFound =
    error instanceof RoomError && error.code === "room-not-found";

  const mySeat: Player | null = useMemo(() => {
    if (!room || !playerId) return null;
    if (room.seats.X === playerId) return "X";
    if (room.seats.O === playerId) return "O";
    return null;
  }, [room, playerId]);

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
    async (index: number) => {
      if (!room || !playerId || !mySeat) return;
      const currentTurn: Player = room.xIsNext ? "X" : "O";
      if (
        room.status === "finished" ||
        currentTurn !== mySeat ||
        room.board[index] !== null
      ) {
        return;
      }

      const snapshot = room;
      const optimisticBoard = room.board.slice();
      optimisticBoard[index] = mySeat;
      // Optimistically reflect the move and pause polling so a stale GET can't
      // clobber it; the authoritative response (incl. any AI move) wins.
      setData({
        ...room,
        board: optimisticBoard,
        xIsNext: !room.xIsNext,
      });
      setPaused(true);
      setActionError(null);
      try {
        const updated = await makeMove(props.id, playerId, index);
        setData(updated);
      } catch (err) {
        setData(snapshot);
        setActionError(roomErrorMessage(err, "Could not make that move."));
      } finally {
        setPaused(false);
      }
    },
    [room, playerId, mySeat, props.id, setData],
  );

  const runAction = useCallback(
    async (action: () => Promise<RoomView>, fallbackMessage: string) => {
      setPaused(true);
      setActionError(null);
      try {
        setData(await action());
      } catch (err) {
        setActionError(roomErrorMessage(err, fallbackMessage));
      } finally {
        setPaused(false);
      }
    },
    [setData],
  );

  const handleClaim = useCallback(
    (seat: Player) => {
      if (!playerId) return;
      void runAction(
        () => claimSeat(props.id, playerId, seat),
        "Could not claim that seat.",
      );
    },
    [props.id, playerId, runAction],
  );

  const handleLeave = useCallback(() => {
    if (!playerId) return;
    void runAction(
      () => leaveSeat(props.id, playerId),
      "Could not leave the seat.",
    );
  }, [props.id, playerId, runAction]);

  const handleNewGame = useCallback(() => {
    if (!playerId) return;
    void runAction(
      () => resetRoom(props.id, playerId),
      "Could not start a new game.",
    );
  }, [props.id, playerId, runAction]);

  const handleShift = useCallback(
    (direction: Direction) => {
      if (!playerId) return;
      void runAction(
        () => shiftRoom(props.id, playerId, direction),
        "Could not shift the grid.",
      );
    },
    [props.id, playerId, runAction],
  );

  if (notFound) {
    return (
      <div className={styles.notFound}>
        <p className={styles.notFoundTitle}>Room no longer exists</p>
        <p className={styles.notFoundHint}>
          It may have been removed or the server restarted.
        </p>
        <Link href="/" className={styles.backLink}>
          Back to lobby
        </Link>
      </div>
    );
  }

  if (!room) {
    return (
      <div className={styles.loading}>
        {error ? "Could not load the room. Retrying…" : "Loading room…"}
      </div>
    );
  }

  const currentTurn: Player = room.xIsNext ? "X" : "O";
  const gameOver = room.status === "finished";
  const winner: Player | null =
    gameOver && room.winningLine
      ? (room.board[room.winningLine[0]] as Player)
      : null;
  const bothSeated = room.seats.X !== null && room.seats.O !== null;
  // O's shift is an alternative to placing on O's own turn, once per game.
  const canShiftNow =
    mySeat === "O" &&
    !gameOver &&
    bothSeated &&
    currentTurn === "O" &&
    !room.oShiftUsed;

  const xLabel = mySeat === "X" ? "You (X)" : "Player X";
  const oLabel =
    room.mode === "ai" ? "AI (O)" : mySeat === "O" ? "You (O)" : "Player O";

  let statusMessage: string;
  let statusTone: StatusTone;
  if (winner) {
    statusMessage = `${winner} wins!`;
    statusTone = playerTone(winner);
  } else if (gameOver) {
    statusMessage = "Draw";
    statusTone = "draw";
  } else if (!bothSeated) {
    statusMessage = "Waiting for opponent";
    statusTone = "neutral";
  } else if (mySeat) {
    statusMessage = currentTurn === mySeat ? "Your turn" : "Opponent's turn";
    statusTone = playerTone(currentTurn);
  } else {
    statusMessage = `${currentTurn} to move`;
    statusTone = playerTone(currentTurn);
  }

  const boardDisabled =
    gameOver || mySeat === null || currentTurn !== mySeat || paused;

  return (
    <div className={styles.root}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back}>
          ← Lobby
        </Link>
        <h1 className={styles.title}>{room.name}</h1>
        <span className={styles.modeTag}>{modeLabel(room.mode)}</span>
      </header>

      <Status message={statusMessage} tone={statusTone} />

      <div className={styles.seatBar}>
        {mySeat ? (
          <>
            <span className={styles.youBadge}>You are playing {mySeat}</span>
            <button
              type="button"
              className={styles.seatButton}
              onClick={handleLeave}
              disabled={paused}
            >
              Leave seat
            </button>
          </>
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

      <Board
        board={room.board}
        winningLine={room.winningLine}
        onSquareClick={handleMove}
        disabled={boardDisabled}
      />

      {canShiftNow && (
        <div className={styles.shiftPanel}>
          <div className={styles.shiftPromptRow}>
            <p className={styles.shiftPrompt}>
              Your one-time shift: slide the whole grid one cell. Marks pushed
              off the edge are removed, and this uses your turn instead of
              placing.
            </p>
            <button
              type="button"
              className={styles.shiftHelpButton}
              onClick={() => setShiftHelpOpen(true)}
              aria-label="What is the grid shift?"
            >
              <IoHelpCircleOutline className={styles.shiftHelpIcon} />
            </button>
          </div>
          <div className={styles.shiftGrid}>
            {SHIFT_OPTIONS.map(({ dir, label }) => (
              <button
                key={dir}
                type="button"
                className={styles.shiftButton}
                onClick={() => handleShift(dir)}
                disabled={paused}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mySeat === "O" && !gameOver && !canShiftNow && (
        <p className={styles.shiftHint}>
          {room.oShiftUsed
            ? "Grid shift used"
            : "One-time grid shift available on your turn"}
        </p>
      )}

      {actionError && <p className={styles.actionError}>{actionError}</p>}

      <Scoreboard scores={room.scores} xLabel={xLabel} oLabel={oLabel} />

      <button
        type="button"
        className={styles.newGame}
        onClick={handleNewGame}
        disabled={paused || mySeat === null}
      >
        New Game
      </button>

      <UIDialog
        isOpen={shiftHelpOpen}
        close={() => setShiftHelpOpen(false)}
        title="Player O's grid shift"
        description="A once-per-game move that only player O can make."
      >
        <p className={styles.shiftHelpParagraph}>
          On your turn as O you can shift the grid instead of placing a mark.
          The shift uses up your turn, so players still alternate strictly, and
          you only get it once per game.
        </p>
        <p className={styles.shiftHelpParagraph}>
          A shift slides the whole 3x3 grid one cell - up, down, left, or right.
          Any marks pushed off the leading edge fall off the board and are
          removed. A shift only translates marks, so it can never complete a
          line and never wins on its own.
        </p>
        <p className={styles.shiftHelpParagraph}>
          It exists to balance the game: X moves first, and O&apos;s single shift is
          the compensation that keeps things fair.
        </p>
      </UIDialog>
    </div>
  );
};

export default RoomGame;
