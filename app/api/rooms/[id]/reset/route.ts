import { resetGame } from "@/lib/roomStore";
import { storeResponse, withPlayerRoute } from "@/utils/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withPlayerRoute(request, params, async ({ id, playerId }) =>
    storeResponse(await resetGame(id, playerId)),
  );
}
