-- Live viewer-presence heartbeats, used to count how many people are watching a
-- room at any moment. Each (room, viewer) keeps at most one row, rewritten on
-- every stream/poll tick and swept by TTL; this is liveness only, never game
-- state, so nothing here is derived into history or replay.

-- CreateTable
CREATE TABLE "room_viewers" (
    "room_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "last_seen" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "room_viewers_pkey" PRIMARY KEY ("room_id","player_id")
);

-- CreateIndex
CREATE INDEX "room_viewers_room_id_last_seen_idx" ON "room_viewers"("room_id", "last_seen");
