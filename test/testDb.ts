import { execFileSync } from "node:child_process";

/**
 * Throwaway local Postgres for the unit suite.
 *
 * The store is now Prisma/Postgres-backed, so `lib/roomStore.test.ts` exercises
 * it against a real, disposable Postgres started in a Docker container - NEVER a
 * real/Neon database. The connection string points only at 127.0.0.1 on a
 * dedicated high port so a test run can never reach a production database.
 *
 * `globalSetup` (test/globalSetup.ts) starts the container once per `vitest run`
 * and applies the committed migration with `prisma migrate deploy`; each test
 * truncates the tables for isolation. `vitest.config.ts` injects
 * `TEST_DATABASE_URL` as `DATABASE_URL` into the worker env so the cached Prisma
 * client (lib/prisma.ts) connects here.
 */
export const TEST_DB = {
  container: "ttt-test-pg",
  image: "postgres:16-alpine",
  port: 54329,
  password: "postgres",
} as const;

export const TEST_DATABASE_URL = `postgresql://postgres:${TEST_DB.password}@127.0.0.1:${TEST_DB.port}/postgres`;

const docker = (args: string[], opts: { ignoreError?: boolean } = {}): string => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (opts.ignoreError) return "";
    throw error;
  }
};

/** True when a Docker daemon is reachable. */
export const dockerAvailable = (): boolean => {
  try {
    docker(["info"]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Start a fresh Postgres container, replacing any stale one, and block until it
 * accepts connections. Idempotent: a leftover container from a crashed run is
 * removed first.
 */
export const startPostgres = (): void => {
  docker(["rm", "-f", TEST_DB.container], { ignoreError: true });
  docker([
    "run",
    "-d",
    "--name",
    TEST_DB.container,
    "-e",
    `POSTGRES_PASSWORD=${TEST_DB.password}`,
    "-p",
    `${TEST_DB.port}:5432`,
    TEST_DB.image,
  ]);

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      docker(["exec", TEST_DB.container, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error("Postgres test container did not become ready in time");
      }
      // Busy-wait briefly; container readiness is usually a few seconds.
      execFileSync("sleep", ["0.5"]);
    }
  }
};

/** Remove the test container. Safe to call even if it is already gone. */
export const stopPostgres = (): void => {
  docker(["rm", "-f", TEST_DB.container], { ignoreError: true });
};
