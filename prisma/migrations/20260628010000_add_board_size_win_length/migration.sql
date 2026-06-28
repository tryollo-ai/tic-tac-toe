-- Configurable board size and win run length (internal game-config).
-- New columns are added with the classic-3x3 defaults so existing rows
-- (live rooms, archived games, the single config row) keep playing/replaying
-- exactly as before.

-- AlterTable
ALTER TABLE "app_config" ADD COLUMN "board_size" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "app_config" ADD COLUMN "win_length" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "size" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "rooms" ADD COLUMN "win_length" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "completed_games" ADD COLUMN "size" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "completed_games" ADD COLUMN "win_length" INTEGER NOT NULL DEFAULT 3;
