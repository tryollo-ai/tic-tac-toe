import prisma from "@/lib/prisma";
import {
  DEFAULT_SHIFT_MODE,
  SHIFT_MODES,
  type ShiftMode,
} from "@/utils/gameLogic";

/**
 * Server-side POC config for game-rule variants - currently just which
 * {@link ShiftMode} new shifts use. Persisted in the single-row `AppConfig`
 * table (see prisma/schema.prisma) so the active mode survives server restarts
 * and is shared across serverless instances. The previous implementation kept it
 * in-memory on `globalThis`, which silently reset to the default on every
 * restart - the source of the "mode keeps reverting to classic" bug.
 *
 * Scope note: only *new* shifts read this. Each recorded shift action captures
 * the mode it was played with, so flipping the toggle never rewrites the history
 * of games already in progress or archived.
 */

/** Fixed primary key of the single config row. */
const CONFIG_ID = "global";

export async function getShiftMode(): Promise<ShiftMode> {
  const row = await prisma.appConfig.findUnique({ where: { id: CONFIG_ID } });
  const mode = row?.shiftMode;
  return mode && SHIFT_MODES.includes(mode as ShiftMode)
    ? (mode as ShiftMode)
    : DEFAULT_SHIFT_MODE;
}

export async function setShiftMode(mode: ShiftMode): Promise<void> {
  await prisma.appConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, shiftMode: mode },
    update: { shiftMode: mode },
  });
}
