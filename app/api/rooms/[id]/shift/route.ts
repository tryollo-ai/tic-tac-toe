import { shiftBoardAction } from "@/lib/roomStore";
import { badRequest, storeResponse, withPlayerRoute } from "@/utils/apiHelpers";
import { DIRECTIONS, type Direction } from "@/utils/gameLogic";

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
  return withPlayerRoute(request, params, async ({ id, body, playerId }) => {
    const { direction } = body;
    if (!isDirection(direction)) return badRequest("invalid-direction");

    return storeResponse(await shiftBoardAction(id, direction, playerId));
  });
}
