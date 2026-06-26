import { NextResponse } from "next/server";
import { getRoom, toView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = new URL(request.url).searchParams.get("playerId") ?? undefined;

  const room = await getRoom(id, playerId);
  if (!room) {
    return NextResponse.json({ error: "room-not-found" }, { status: 404 });
  }
  return NextResponse.json({ room: toView(room) });
}
