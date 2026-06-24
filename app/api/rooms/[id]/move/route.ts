import { makeMove } from "@/lib/roomStore";
import { badRequest, parsePlayerBody, storeResponse } from "@/utils/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;

  const index =
    typeof parsed.body.index === "number" ? parsed.body.index : NaN;
  if (!Number.isInteger(index)) return badRequest();

  return storeResponse(makeMove(id, index, parsed.playerId));
}
