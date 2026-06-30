import { claimSeat, leaveSeat } from "@/lib/roomStore";
import { badRequest, storeResponse, withPlayerRoute } from "@/utils/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withPlayerRoute(request, params, async ({ id, body, playerId }) => {
    const { seat, name } = body;
    if (seat !== "X" && seat !== "O") return badRequest("invalid-seat");

    // The display name is optional; the store sanitizes it (trim/clip/empty→null).
    const displayName = typeof name === "string" ? name : undefined;
    return storeResponse(await claimSeat(id, seat, playerId, displayName));
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withPlayerRoute(request, params, async ({ id, playerId }) =>
    storeResponse(await leaveSeat(id, playerId)),
  );
}
