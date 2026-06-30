-- Live participant-presence heartbeats, used to count how many people are
-- watching a room at any moment. Each (room, participant) keeps at most one row,
-- rewritten on every stream/poll tick and swept by TTL; this is liveness only,
-- never game state, so nothing here is derived into history or replay.

-- CreateTable
CREATE TABLE "room_participants" (
    "room_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "last_seen" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "room_participants_pkey" PRIMARY KEY ("room_id","player_id")
);

-- CreateIndex
CREATE INDEX "room_participants_room_id_last_seen_idx" ON "room_participants"("room_id", "last_seen");
