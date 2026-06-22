import { NextResponse } from "next/server";
import {
  createRoom,
  errorStatus,
  listRooms,
  toView,
} from "@/lib/roomStore";
import type { RoomMode } from "@/lib/roomTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rooms: listRooms() });
}

export async function POST(request: Request) {
  let body: { name?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const mode: RoomMode = body.mode === "ai" ? "ai" : "two-player";

  const result = createRoom(name, mode);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) }, { status: 201 });
}
