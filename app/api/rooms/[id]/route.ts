import { NextResponse } from "next/server";
import {
  countViewers,
  getRoom,
  heartbeatViewer,
  toView,
} from "@/lib/roomStore";

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
  // The polling fallback (used when the SSE stream can't connect) heartbeats the
  // viewer here too, so the watcher count stays accurate without a live stream.
  if (playerId) await heartbeatViewer(id, playerId);
  const viewerCount = await countViewers(id);
  return NextResponse.json({ room: toView(room, viewerCount) });
}
