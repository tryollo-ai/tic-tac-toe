import { makeMove } from "@/lib/roomStore";
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
  const index = typeof body.index === "number" ? body.index : NaN;
  if (!playerId || !Number.isInteger(index)) return badRequest();

  return storeResponse(makeMove(id, index, playerId));
}
