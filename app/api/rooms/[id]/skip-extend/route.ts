import { skipExtend } from "@/lib/roomStore";
import { parsePlayerBody, storeResponse } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;

  return storeResponse(skipExtend(id, parsed.playerId));
}
