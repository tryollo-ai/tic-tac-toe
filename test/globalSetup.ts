import { execFileSync } from "node:child_process";
import {
  TEST_DATABASE_URL,
  dockerAvailable,
  startPostgres,
  stopPostgres,
} from "./testDb";

/**
 * Vitest global setup: bring up the throwaway Postgres and apply the committed
 * migration before any test runs, then tear the container down afterwards.
 *
 * Runs once per `vitest run`. The store tests need a live database; the pure
 * game-logic tests ignore it. If Docker is not available we fail loudly rather
 * than silently skipping the database-backed tests - the suite is meant to run
 * against a real local Postgres.
 */
export default async function setup() {
  if (!dockerAvailable()) {
    throw new Error(
      "Docker is required to run the test suite (it starts a throwaway Postgres). " +
        "Start Docker and re-run, or run a Postgres reachable at TEST_DATABASE_URL.",
    );
  }

  startPostgres();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  return () => {
    stopPostgres();
  };
}
