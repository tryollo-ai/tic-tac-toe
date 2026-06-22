import { claimSeat, leaveSeat } from "@/lib/roomStore";
import { badRequest, parseJsonBody, storeResponse } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  if (!body) return badRequest();

  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) return badRequest();
  if (body.seat !== "X" && body.seat !== "O") return badRequest("invalid-seat");

  return storeResponse(claimSeat(id, body.seat, playerId));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  if (!body) return badRequest();

  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) return badRequest();

  return storeResponse(leaveSeat(id, playerId));
}
