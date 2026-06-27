import { NextResponse } from "next/server";
import { getShiftMode, setShiftMode } from "@/lib/gameConfig";
import { parseJsonBody, badRequest } from "@/utils/apiHelpers";
import { SHIFT_MODES, type ShiftMode } from "@/utils/gameLogic";

export const dynamic = "force-dynamic";

function isShiftMode(value: unknown): value is ShiftMode {
  return typeof value === "string" && SHIFT_MODES.includes(value as ShiftMode);
}

/** Read the current internal game config. Intentionally open (POC tooling). */
export async function GET() {
  return NextResponse.json({ shiftMode: getShiftMode() });
}

/**
 * Set the active shift mode. Anyone can call this - it is an internal POC toggle
 * for trying out the experimental "collapse" shift, by design.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body || !isShiftMode(body.shiftMode)) return badRequest("invalid-mode");

  setShiftMode(body.shiftMode);
  return NextResponse.json({ shiftMode: getShiftMode() });
}
