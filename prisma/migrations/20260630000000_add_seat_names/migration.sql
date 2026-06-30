-- Player-chosen display names per seat, so both players can see who they're
-- playing against. Nullable so existing rows (live rooms in progress) keep
-- playing as before - a seat with no name simply falls back to "Player X/O".

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "seat_x_name" TEXT;
ALTER TABLE "rooms" ADD COLUMN "seat_o_name" TEXT;
