-- CreateTable
CREATE TABLE "app_config" (
    "id" TEXT NOT NULL,
    "shift_mode" TEXT NOT NULL DEFAULT 'classic',

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);
