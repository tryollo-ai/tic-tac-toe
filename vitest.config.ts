import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/testDb";

// Mirror the `@/*` -> project-root path alias from tsconfig.json so tests can
// import the lib modules the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // The store is Prisma/Postgres-backed: globalSetup starts a throwaway local
    // Postgres and applies the migration; inject its URL so the cached Prisma
    // client (lib/prisma.ts) connects there - never a real/Neon database.
    globalSetup: ["./test/globalSetup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
