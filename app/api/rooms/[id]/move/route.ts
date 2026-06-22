import { NextResponse } from "next/server";
import { errorStatus, makeMove, toView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { playerId?: unknown; index?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const index = typeof body.index === "number" ? body.index : NaN;
  if (!playerId || !Number.isInteger(index)) {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const result = makeMove(id, index, playerId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) });
}
