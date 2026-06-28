-- Player X's conditional once-per-game grid shift.
-- The new column is added defaulting to false so existing rows (live rooms in
-- progress) keep playing as before - X is simply marked as not having used it.

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "x_shift_used" BOOLEAN NOT NULL DEFAULT false;
