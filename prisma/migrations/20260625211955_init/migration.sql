-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "board" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "x_is_next" BOOLEAN NOT NULL,
    "score_x" INTEGER NOT NULL DEFAULT 0,
    "score_o" INTEGER NOT NULL DEFAULT 0,
    "score_draws" INTEGER NOT NULL DEFAULT 0,
    "seat_x" TEXT,
    "seat_o" TEXT,
    "seat_seen_x" TIMESTAMPTZ,
    "seat_seen_o" TIMESTAMPTZ,
    "mode" TEXT NOT NULL,
    "o_shift_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completed_games" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completed_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_last_activity_idx" ON "rooms"("last_activity");

-- CreateIndex
CREATE INDEX "completed_games_completed_at_idx" ON "completed_games"("completed_at");

