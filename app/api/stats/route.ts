import { NextResponse } from "next/server";
import { getPlayerStats } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const playerId = new URL(request.url).searchParams.get("playerId") ?? "";
  return NextResponse.json({ stats: await getPlayerStats(playerId) });
}
