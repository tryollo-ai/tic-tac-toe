import { NextResponse } from "next/server";
import { getCompletedGame, toCompletedView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await getCompletedGame(id);
  if (!game) {
    return NextResponse.json({ error: "game-not-found" }, { status: 404 });
  }
  return NextResponse.json({ game: toCompletedView(game) });
}
