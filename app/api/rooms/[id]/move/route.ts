import { makeMove } from "@/lib/roomStore";
import { badRequest, storeResponse, withPlayerRoute } from "@/utils/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withPlayerRoute(request, params, async ({ id, body, playerId }) => {
    const index = typeof body.index === "number" ? body.index : NaN;
    if (!Number.isInteger(index)) return badRequest();

    return storeResponse(await makeMove(id, index, playerId));
  });
}
