import { NextResponse } from "next/server";
import { errorStatus, toView, type StoreResult } from "@/lib/roomStore";

/** Parse a JSON request body, returning null if it is missing or malformed. */
export async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A 400 response carrying a store-style error code. */
export function badRequest(error = "invalid-body"): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * Parse the JSON body and pull out the required string `playerId` that every
 * mutation route needs. Returns the parsed body plus playerId, or an `error`
 * response when the body is missing/malformed or playerId is absent.
 */
export async function parsePlayerBody(
  request: Request,
): Promise<
  | { body: Record<string, unknown>; playerId: string; error?: undefined }
  | { error: NextResponse; body?: undefined; playerId?: undefined }
> {
  const body = await parseJsonBody(request);
  if (!body) return { error: badRequest() };
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) return { error: badRequest() };
  return { body, playerId };
}

/**
 * Shared entry point for the mutation routes: await the dynamic `id` param,
 * parse the player body, and short-circuit with the error response when the
 * body is missing/malformed or playerId is absent. On success the handler runs
 * with the resolved `id`, parsed `body`, and `playerId`.
 */
export async function withPlayerRoute(
  request: Request,
  params: Promise<{ id: string }>,
  handler: (ctx: {
    id: string;
    body: Record<string, unknown>;
    playerId: string;
  }) => Promise<NextResponse>,
): Promise<NextResponse> {
  const { id } = await params;
  const parsed = await parsePlayerBody(request);
  if (parsed.error) return parsed.error;
  return handler({ id, body: parsed.body, playerId: parsed.playerId });
}

/**
 * Turn a StoreResult into its HTTP response: the error code mapped to a status
 * on failure, or the room view (defaulting to 200) on success.
 */
export function storeResponse(
  result: StoreResult,
  successStatus = 200,
): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ room: toView(result.room) }, { status: successStatus });
}
