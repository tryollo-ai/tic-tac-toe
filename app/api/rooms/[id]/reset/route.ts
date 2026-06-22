import { NextResponse } from "next/server";
import { errorStatus, resetGame, toView } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // playerId is accepted for symmetry but reset is open to any participant.
  try {
    await request.json();
  } catch {
    // Body is optional for reset.
  }

  const result = resetGame(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) });
}
