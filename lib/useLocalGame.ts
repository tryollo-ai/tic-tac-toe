"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aiReply,
  canShift as engineCanShift,
  claim,
  createLocalGame,
  currentTurn as engineCurrentTurn,
  isOver,
  leave,
  LOCAL_PLAYER,
  place,
  shift,
  startNextRound,
  type LocalGameState,
  type LocalMode,
} from "@/lib/localGameEngine";
import { useStepCue } from "@/lib/useStepCue";
import { AUTO_RESET_MS } from "@/constants/game";
import { SHIFT_SLIDE_MS } from "@/constants/animation";
import {
  boardAfterActions,
  calculateWinner,
  DEFAULT_SHIFT_MODE,
  type Direction,
  type Player,
  type ShiftMode,
} from "@/utils/gameLogic";
import type { RoomView } from "@/lib/roomTypes";
import type { UseRoomResult } from "@/lib/useRoom";
import type { BoardTransition } from "@/common/components/Board";

/**
 * Beat held after a placement before the AI's reply appears, so the move reads
 * as a deliberate turn rather than landing in the same frame as the human's.
 */
const AI_MOVE_DELAY_MS = 450;

/**
 * Beat held after O's shift slide settles before the AI's reply is revealed, so
 * the move reads as a distinct turn on the tail of the slide. Mirrors the online
 * room's reveal timing (see useRoom).
 */
const AI_SHIFT_REPLY_DELAY_MS = 500;

export interface LocalGameConfig {
  size: number;
  winLength: number;
  shiftMode: ShiftMode;
}

/**
 * Drive a single-device game (local pass-and-play or vs-AI) entirely in the
 * browser - no server room, no API calls, no persistence. Returns the exact
 * {@link UseRoomResult} shape the online room exposes so the same `GameView`
 * renders both; the difference is only where the state lives. The pure rules sit
 * in {@link import("@/lib/localGameEngine")}; this hook owns the React state, the
 * AI reply / shift-reveal timing, and the post-game auto-reset.
 */
export function useLocalGame(
  mode: LocalMode,
  config: LocalGameConfig,
  name: string,
): UseRoomResult {
  const [game, setGame] = useState<LocalGameState>(() => {
    const fresh = createLocalGame(mode, config);
    // Local pass-and-play has no side to choose - one person plays both - so it
    // auto-seats and starts immediately. A vs-AI game stays unseated until the
    // human picks a mark.
    return mode === "local" ? claim(fresh, "X") : fresh;
  });
  // The moment of the last applied action, so the game-over countdown bar (which
  // reads room.lastActivity) starts full and empties exactly as the auto-reset
  // fires.
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);

  // Pending AI-reply timer, cleared on a new action, leave, or unmount so a
  // stale reply can never land after the game has moved on.
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAiTimer = useCallback(() => {
    if (aiTimerRef.current) {
      clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearAiTimer, [clearAiTimer]);

  // Commit a new game state and stamp the activity time together.
  const commit = useCallback((next: LocalGameState) => {
    setGame(next);
    setLastActivity(Date.now());
  }, []);

  // After a human action in a vs-AI game, reveal the AI's reply after `delay`,
  // holding `paused` across it so the board stays inert until the AI has moved.
  const scheduleAiReply = useCallback(
    (afterHuman: LocalGameState, delay: number) => {
      const replied = aiReply(afterHuman);
      if (replied === afterHuman) return; // local game, or not the AI's turn
      setPaused(true);
      clearAiTimer();
      aiTimerRef.current = setTimeout(() => {
        aiTimerRef.current = null;
        commit(replied);
        setPaused(false);
      }, delay);
    },
    [clearAiTimer, commit],
  );

  const mySeat: Player | null = useMemo(() => {
    const holdsX = game.seats.X === LOCAL_PLAYER;
    const holdsO = game.seats.O === LOCAL_PLAYER;
    // Local pass-and-play: one player holds both seats and plays whichever side
    // is on turn, so the seat they act as is simply the on-turn side.
    if (holdsX && holdsO) return game.xIsNext ? "X" : "O";
    if (holdsX) return "X";
    if (holdsO) return "O";
    return null;
  }, [game.seats, game.xIsNext]);

  const currentTurn = engineCurrentTurn(game);
  const gameOver = isOver(game);

  const handleClaim = useCallback(
    (seat: Player) => {
      clearAiTimer();
      setPaused(false);
      commit(claim(game, seat));
    },
    [game, commit, clearAiTimer],
  );

  const handleLeave = useCallback(() => {
    clearAiTimer();
    setPaused(false);
    setShiftActive(false);
    commit(leave(game));
  }, [game, commit, clearAiTimer]);

  const handleMove = useCallback(
    (index: number) => {
      if (paused || gameOver) return;
      const afterHuman = place(game, index);
      if (afterHuman === game) return; // invalid (cell taken / not playable)
      commit(afterHuman);
      scheduleAiReply(afterHuman, AI_MOVE_DELAY_MS);
    },
    [game, paused, gameOver, commit, scheduleAiReply],
  );

  const handleShift = useCallback(
    (direction: Direction) => {
      if (paused || gameOver) return;
      setShiftActive(false);
      const afterShift = shift(game, direction);
      if (afterShift === game) return; // the seat could not shift
      // Render the shifted board first so its slide plays out; the AI's reply
      // (if any) is revealed only once the slide has settled.
      commit(afterShift);
      scheduleAiReply(afterShift, SHIFT_SLIDE_MS + AI_SHIFT_REPLY_DELAY_MS);
    },
    [game, paused, gameOver, commit, scheduleAiReply],
  );

  // Auto-reset: once a finished game has been on screen for AUTO_RESET_MS, start
  // the next round (scores carry over; an AI on X opens it). Mirrors the online
  // room's server-driven reset, but here a plain client timer drives it.
  useEffect(() => {
    if (!gameOver) return;
    const elapsed = Date.now() - lastActivity;
    const remaining = Math.max(0, AUTO_RESET_MS - elapsed);
    const timer = setTimeout(() => {
      setShiftActive(false);
      commit(startNextRound(game));
    }, remaining);
    return () => clearTimeout(timer);
  }, [gameOver, lastActivity, game, commit]);

  // Disarm the shift picker the moment the viewer can no longer shift.
  const canShiftNow =
    mySeat !== null && currentTurn === mySeat && engineCanShift(game, mySeat);
  useEffect(() => {
    if (!canShiftNow && shiftActive) setShiftActive(false);
  }, [canShiftNow, shiftActive]);

  // Build the board's shift-animation cue during render so the post-shift board
  // and its cue reach <Board> together (see the same pattern in useRoom).
  const boardTransition = useStepCue<BoardTransition>(
    game.actions.length,
    (count, prev) => {
      if (prev === null || count <= prev) return null;
      const latest = game.actions[count - 1];
      if (latest?.kind !== "shift") return null;
      return {
        kind: "shift",
        direction: latest.dir,
        mode: latest.mode ?? DEFAULT_SHIFT_MODE,
        from: boardAfterActions(game.actions, count - 1, game.size),
      };
    },
  );

  // Present the engine state as the RoomView GameView renders. The id/seatSeen/
  // createdAt fields exist only to satisfy the shared shape; nothing client-side
  // reads them. The AI sentinel seat is surfaced as-is so seat labels read
  // "AI (O)" just like the online room.
  const room: RoomView = useMemo(() => {
    const winner = calculateWinner(game.board, game.winLength);
    return {
      id: `local-${mode}`,
      name,
      board: game.board,
      size: game.size,
      winLength: game.winLength,
      actions: game.actions,
      xIsNext: game.xIsNext,
      scores: game.scores,
      seats: game.seats,
      // Single-device games have no remote opponent to name; the seat labels read
      // "You"/"AI", so names stay null.
      seatNames: { X: null, O: null },
      mode,
      oShiftUsed: game.oShiftUsed,
      xShiftUsed: game.xShiftUsed,
      seatSeen: { X: null, O: null },
      createdAt: lastActivity,
      lastActivity,
      status:
        game.actions.length === 0
          ? "waiting"
          : gameOver
            ? "finished"
            : "in-progress",
      winningLine: winner ? winner.line : null,
    };
  }, [game, mode, name, lastActivity, gameOver]);

  const boardDisabled =
    gameOver ||
    mySeat === null ||
    currentTurn !== mySeat ||
    paused ||
    shiftActive;

  return {
    room,
    error: undefined,
    notFound: false,
    streamConnected: false,

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

    actionError: null,
    // Single-device games never alternate sides, so there is no first/second to
    // announce between rounds.
    roundAnnouncement: null,
    boardTransition,
  };
}
