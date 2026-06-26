# Database

Room and completed-game state is persisted in Postgres (Neon in production) via
[Prisma](https://www.prisma.io/).
This replaces the per-instance in-memory `Map` that made production rooms vanish
or reappear when serverless instances rotated (issue #49).

- Schema: [`prisma/schema.prisma`](../prisma/schema.prisma) - two models, `Room` and `CompletedGame`.
- Migrations: [`prisma/migrations/`](../prisma/migrations) - managed by Prisma Migrate; never edit applied migration SQL by hand.
- Client: [`lib/prisma.ts`](../lib/prisma.ts) - a cached `PrismaClient` singleton (the standard Next.js pattern) so serverless instances don't leak connection pools.

Timestamps (`created_at`, `last_activity`, `completed_at`, `seat_seen_x/o`) are
stored as Postgres `timestamptz`, **not** epoch-ms integers - a deliberate
decision so the database holds real instants.

> The room store (`lib/roomStore.ts`) now persists exclusively to Postgres via
> Prisma, so a reachable `DATABASE_URL` is **required** to run the app (the
> lobby, rooms, and replay all read/write through the database). The unit tests
> do **not** need this setup - they spin up their own throwaway local Postgres in
> Docker (see the Testing section of [AGENTS.md](../AGENTS.md)).

This project uses **yarn** (`yarn@1.22.21`). The `prisma` CLI is invoked below
with `npx prisma ...`, which works regardless of package manager; the equivalent
`yarn db:*` scripts are noted alongside.

## Set up the database

1. **Create a Neon project.**
   Sign in at [neon.tech](https://neon.tech), create a new project, and open
   **Dashboard -> Connection Details**.
   Copy the connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
   ```

   Prefer the **pooled** connection string for a serverless app like this one.
   Keep the `?sslmode=require` suffix - Neon requires SSL.

2. **Create your local env file from the template and paste the URL in.**

   ```bash
   cp .env.example .env.local
   ```

   Open `.env.local` and set `DATABASE_URL` to the string you copied:

   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
   ```

   `.env.local` is gitignored - never commit a real connection string.

3. **Install dependencies** (this also generates the Prisma client via the
   `postinstall` script):

   ```bash
   yarn install
   ```

## Run the migrations

4. **Create all tables against Neon** by applying the committed migrations:

   ```bash
   npx prisma migrate deploy
   ```

   (equivalently: `yarn db:migrate`.)
   This is non-interactive and idempotent - it applies every migration in
   `prisma/migrations/` that hasn't run yet and records them in the
   `_prisma_migrations` table. It is the right command for CI and production; it
   never tries to author new migrations or reset data.

5. **Verify the tables exist.** Either open Prisma's GUI:

   ```bash
   npx prisma studio
   ```

   or list the tables with `psql`:

   ```bash
   psql "$DATABASE_URL" -c '\dt'
   ```

   You should see `rooms` and `completed_games` (plus Prisma's
   `_prisma_migrations` bookkeeping table).

## Production (Vercel)

Set the **same** `DATABASE_URL` in the Vercel project's environment variables
(**Project -> Settings -> Environment Variables**, for the Production
environment) so the deployed app connects to the same Neon database.
After setting it, run the migrations against that database once with
`npx prisma migrate deploy` (it is safe to re-run; already-applied migrations are
skipped).

## Changing the schema (for contributors)

Edit `prisma/schema.prisma`, then author a new migration against a local/dev
database:

```bash
npx prisma migrate dev --name <change_name>
```

(equivalently: `yarn db:migrate:dev`.)
Commit the generated `prisma/migrations/<timestamp>_<change_name>/` directory.
Then `npx prisma migrate deploy` (`yarn db:migrate`) rolls it out everywhere.
