import { NextResponse } from "next/server";
import { listCompletedGames } from "@/lib/roomStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ games: await listCompletedGames() });
}
