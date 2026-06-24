import { NextResponse } from "next/server";
import { createRoom, listRooms } from "@/lib/roomStore";
import { badRequest, parseJsonBody, storeResponse } from "@/utils/apiHelpers";
import type { RoomMode } from "@/lib/roomTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rooms: listRooms() });
}

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body) return badRequest();

  const name = typeof body.name === "string" ? body.name : "";
  const mode: RoomMode = body.mode === "ai" ? "ai" : "two-player";

  return storeResponse(createRoom(name, mode), 201);
}
