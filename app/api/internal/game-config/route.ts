import { NextResponse } from "next/server";
import {
  getGameConfig,
  setGameConfig,
  type GameConfigUpdate,
} from "@/lib/gameConfig";
import { parseJsonBody, badRequest } from "@/utils/apiHelpers";
import { SHIFT_MODES, type ShiftMode } from "@/utils/gameLogic";

export const dynamic = "force-dynamic";

function isShiftMode(value: unknown): value is ShiftMode {
  return typeof value === "string" && SHIFT_MODES.includes(value as ShiftMode);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Read the current internal game config. Intentionally open (POC tooling). */
export async function GET() {
  return NextResponse.json(await getGameConfig());
}

/**
 * Update the internal config: the active shift mode, the board size new games
 * use, and/or the win run length. Any subset of fields may be sent; omitted ones
 * are left unchanged, and size/run length are clamped to the supported range and
 * to each other server-side. Anyone can call this - it is an internal POC toggle
 * by design.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body) return badRequest("invalid-body");

  const update: GameConfigUpdate = {};
  if ("shiftMode" in body) {
    if (!isShiftMode(body.shiftMode)) return badRequest("invalid-mode");
    update.shiftMode = body.shiftMode;
  }
  if ("boardSize" in body) {
    if (!isPositiveInt(body.boardSize)) return badRequest("invalid-board-size");
    update.boardSize = body.boardSize;
  }
  if ("winLength" in body) {
    if (!isPositiveInt(body.winLength)) return badRequest("invalid-win-length");
    update.winLength = body.winLength;
  }

  return NextResponse.json(await setGameConfig(update));
}
