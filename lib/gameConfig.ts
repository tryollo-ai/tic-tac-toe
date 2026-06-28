import {
  DEFAULT_WIN_LENGTH,
  INITIAL_SIZE,
  MAX_BOARD_SIZE,
  MIN_BOARD_SIZE,
  MIN_WIN_LENGTH,
} from "@/constants/game";
import prisma from "@/lib/prisma";
import {
  DEFAULT_SHIFT_MODE,
  SHIFT_MODES,
  type ShiftMode,
} from "@/utils/gameLogic";

/**
 * Server-side POC config for game-rule variants: which {@link ShiftMode} new
 * shifts use, and the board size / win run length new games are created at.
 * Persisted in the single-row `AppConfig` table (see prisma/schema.prisma) so the
 * active config survives server restarts and is shared across serverless
 * instances. The previous implementation kept it in-memory on `globalThis`,
 * which silently reset to the default on every restart - the source of the "mode
 * keeps reverting to classic" bug.
 *
 * Scope note: only *new* shifts read the mode, and only *new* games read the
 * size/run length. Each recorded shift action captures the mode it was played
 * with, and each room/archived game captures the size and run it was created
 * with, so flipping any of these never rewrites the history of games already in
 * progress or archived.
 */

/** Fixed primary key of the single config row. */
const CONFIG_ID = "global";

/** The full internal config, as read by callers and the config page. */
export interface GameConfig {
  shiftMode: ShiftMode;
  boardSize: number;
  winLength: number;
}

/** A partial update to the config; omitted fields are left unchanged. */
export type GameConfigUpdate = Partial<GameConfig>;

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** Snap a board size into the supported range. */
export function normalizeBoardSize(value: number): number {
  return clampInt(value, MIN_BOARD_SIZE, MAX_BOARD_SIZE);
}

/** Snap a win length into range: at least the minimum, never longer than the
 *  board can hold a straight run of. */
export function normalizeWinLength(value: number, boardSize: number): number {
  return clampInt(value, MIN_WIN_LENGTH, boardSize);
}

/** Coerce a stored shift mode (or anything unexpected) to a valid mode. */
function normalizeShiftMode(value: string | null | undefined): ShiftMode {
  return value && SHIFT_MODES.includes(value as ShiftMode)
    ? (value as ShiftMode)
    : DEFAULT_SHIFT_MODE;
}

export async function getGameConfig(): Promise<GameConfig> {
  const row = await prisma.appConfig.findUnique({ where: { id: CONFIG_ID } });
  const boardSize = normalizeBoardSize(row?.boardSize ?? INITIAL_SIZE);
  return {
    shiftMode: normalizeShiftMode(row?.shiftMode),
    boardSize,
    winLength: normalizeWinLength(row?.winLength ?? DEFAULT_WIN_LENGTH, boardSize),
  };
}

export async function getShiftMode(): Promise<ShiftMode> {
  return (await getGameConfig()).shiftMode;
}

/**
 * Apply a partial config update and return the resulting full config. Size and
 * run length are validated against each other and the supported bounds (so e.g.
 * raising the run above a freshly-lowered size is impossible), keeping the stored
 * config always self-consistent.
 */
export async function setGameConfig(
  update: GameConfigUpdate,
): Promise<GameConfig> {
  const current = await getGameConfig();
  const next: GameConfig = {
    shiftMode: normalizeShiftMode(update.shiftMode ?? current.shiftMode),
    boardSize: normalizeBoardSize(update.boardSize ?? current.boardSize),
    winLength: 0, // set below, once the final board size is known
  };
  next.winLength = normalizeWinLength(
    update.winLength ?? current.winLength,
    next.boardSize,
  );

  await prisma.appConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...next },
    update: next,
  });
  return next;
}

export async function setShiftMode(mode: ShiftMode): Promise<void> {
  await setGameConfig({ shiftMode: mode });
}
