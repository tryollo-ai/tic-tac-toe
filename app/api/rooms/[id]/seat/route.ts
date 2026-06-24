import { claimSeat, leaveSeat } from "@/lib/roomStore";
import { badRequest, parsePlayerBody, storeResponse } from "@/utils/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;

  const { seat } = parsed.body;
  if (seat !== "X" && seat !== "O") return badRequest("invalid-seat");

  return storeResponse(claimSeat(id, seat, parsed.playerId));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;

  return storeResponse(leaveSeat(id, parsed.playerId));
}
