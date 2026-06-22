import { NextResponse } from "next/server";
import { errorStatus, resetGame, toView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { playerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const result = resetGame(id, playerId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) });
}
