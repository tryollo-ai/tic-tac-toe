import { extendBoardAction } from "@/lib/roomStore";
import { badRequest, parsePlayerBody, storeResponse } from "@/lib/apiHelpers";
import { DIRECTIONS, type Direction } from "@/lib/gameLogic";

export const dynamic = "force-dynamic";

function isDirection(value: unknown): value is Direction {
  return (
    typeof value === "string" && DIRECTIONS.includes(value as Direction)
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;

  const { direction } = parsed.body;
  if (!isDirection(direction)) return badRequest("invalid-direction");

  return storeResponse(extendBoardAction(id, direction, parsed.playerId));
}
