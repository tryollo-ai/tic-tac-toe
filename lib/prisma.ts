import { PrismaClient } from "@prisma/client";

/**
 * Cached Prisma client (the standard Next.js singleton pattern).
 *
 * In development Next.js clears the module cache on every hot-reload, and in a
 * serverless deployment each warm invocation reuses the same process. Without
 * caching, both would create a fresh `PrismaClient` - and therefore a fresh
 * connection pool - on every reload/invocation, exhausting the database's
 * connection limit. Stashing one instance on `globalThis` guarantees a single
 * client per process.
 *
 * Nothing imports this yet; it is the foundation for the upcoming Postgres-backed
 * room store (issue #49). See prisma/schema.prisma and docs/database.md.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
