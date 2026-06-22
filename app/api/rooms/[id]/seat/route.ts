import { NextResponse } from "next/server";
import { claimSeat, errorStatus, leaveSeat, toView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { playerId?: unknown; seat?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }
  if (body.seat !== "X" && body.seat !== "O") {
    return NextResponse.json({ error: "invalid-seat" }, { status: 400 });
  }

  const result = claimSeat(id, body.seat, playerId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) });
}

export async function DELETE(
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

  const result = leaveSeat(id, playerId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) });
}
