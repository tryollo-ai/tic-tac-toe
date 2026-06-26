# Tic-Tac-Toe

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby to play across browsers or spectate a live
game.

## Features

- **Game rooms & lobby:** the landing page lists open rooms with live status and
  a board preview; create a room as two-player or vs an AI. The list is paginated
  (6 rooms per page) with Previous/Next navigation once there is more than one
  page. A "How to play" button by the title opens a dialog explaining the rules,
  including player O's grid shift, before you enter a room.
- **Seat claiming:** visitors claim an open X or O seat, and everyone else
  spectates. Your identity is stored per browser, and only the seat-holder whose
  turn it is can move.
- **Near-real-time play:** rooms receive live pushes over a Server-Sent Events
  stream (`GET /api/rooms/[id]/stream`), so moves and seat changes appear for
  everyone within ~1–2 seconds. Polling falls back to 10s while the stream is
  connected and reverts to 1.5s if the stream can't connect (e.g. a buffering
  proxy), so updates always flow. A seat auto-releases after 30s without a
  heartbeat (for example, when its player closes the tab).
- **Grid-shift action (O only):** to offset X's first-move advantage, player O
  gets one once-per-game action that slides the whole 3x3 grid one cell
  (up/down/left/right).
  Any marks pushed off the leading edge are removed, and empty cells enter
  behind.
  Shifting is an alternative to placing a mark and uses up O's turn, so O weighs
  reshaping the board against taking a square.
  A win is always three in a row.
- **AI opponent:** in a vs-AI room the computer plays O server-side with minimax,
  and never loses on the 3x3 board.
  As O it also decides when to spend its one-time grid shift, weighing the shift
  against its best placement each turn.
- **Move history:** one mini-board snapshot per move, oldest first and newest
  last, each labelled with who moved and what they did (a named cell or O's
  grid shift). On desktop it appears as a faded column to the left of the board,
  fades up to full visibility on hover, and scrolls within a bounded height via
  up/down arrow buttons. On mobile (≤760px) it sits below the board as a
  horizontally scrolling strip; the up/down arrows are hidden and native swipe
  scrolling is used instead, so a growing history never pushes the board down
  the page.
- **Scoreboard** tracking wins for each side and draws across rounds.
- **Win-line highlight:** the three winning cells are highlighted and a green
  line is drawn connecting them, alongside a clear turn/winner status indicator.
  The same overlay appears in replay and over a completed three-in-a-row in the
  lobby and completed-game board previews.
- **Completed games & replay:** every finished game is archived and listed on the
  lobby below the active rooms.
  Archived games can no longer be played, but each one can be replayed turn by
  turn (step forward/back, jump to start/end, or auto-play) on its own
  `/replay/[id]` page.
  The archive survives the room being reset for a new round, so a single room can
  accumulate a history of games. A finished game auto-resets to a fresh round
  after a short delay (no manual button), with a "Next game starting…" note shown
  during the countdown.
- Responsive, dark-themed UI styled with **SCSS CSS Modules** (no Tailwind).

Room and completed-game state lives in an in-memory server store with no external
dependencies, so everything resets when the server restarts.

## Getting started

```bash
yarn install
yarn dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Database

Room state is moving from an in-memory `Map` to Postgres (Neon in production) via
Prisma, so rooms survive restarts and serverless cold starts (issue #49).
The schema lives in [`prisma/schema.prisma`](./prisma/schema.prisma) and the
cached client in [`lib/prisma.ts`](./lib/prisma.ts).
The app still runs entirely on the in-memory store until the store is migrated
over, so you do not need a database to develop locally.

To provision the database and run the migrations against Neon (or any Postgres),
follow the copy-pasteable guide in [docs/database.md](./docs/database.md).

## Scripts

- `yarn dev` - start the development server
- `yarn build` - create a production build
- `yarn start` - run the production build
- `yarn lint` - lint the codebase
- `yarn test` - run the Vitest unit suite once
- `yarn deploy` - deploy to Vercel production (`vercel --prod`); also runs automatically on every push to `main` via `.github/workflows/deploy.yml` (requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` repository secrets; skips silently without them)
- `yarn db:migrate` - apply all committed migrations to `DATABASE_URL` (`prisma migrate deploy`); use this in CI/production
- `yarn db:migrate:dev` - create/apply a migration during development (`prisma migrate dev`)
- `yarn db:generate` - regenerate the Prisma client (`prisma generate`); also runs automatically on `postinstall`

The agent-dispatch ticket-selection and board-sync CLIs are packaged in the
self-contained [agent-kit/](./agent-kit/) and run via `npx tsx agent-kit/scripts/<name>.cli.ts`
(no `package.json` aliases); see [agent-kit/docs/operations.md](./agent-kit/docs/operations.md).

## Project structure

```
app/                      # App Router: lobby, /room/[id], /replay/[id], styles
app/api/rooms/            # REST endpoints: list/create rooms, seats, moves,
                          #   reset, shift; [id]/stream — SSE live-room feed
app/api/completed/        # REST endpoints: list completed games + fetch one for replay
common/components/<Name>/ # One folder per shared component: index.tsx entry + styles.module.scss
utils/gameLogic.ts        # Pure game logic: winner detection, O's whole-grid
                          #   shift, and the minimax AI
utils/roomClient.ts       # Browser fetch helpers for the room API; `subscribeRoom` opens an SSE stream
utils/apiHelpers.ts       # Shared request/response helpers for the room API routes
utils/winningLineGeometry.ts # Pure winning-line overlay geometry (cell-center percentages)
utils/historyLabels.ts    # Pure move-history labels: player parity + cell/shift names
lib/roomStore.ts          # In-memory server store (Map on globalThis); all validation
lib/roomTypes.ts          # Shared room, seat, score, and completed-game types
lib/usePlayerId.ts        # Client hook: stable per-browser player id
lib/useRoomStream.ts      # Client hook: SSE subscription for live room updates
app/providers.tsx         # Client root: stable React Query QueryClientProvider
constants/game.ts         # Cross-cutting domain constants (board size, AI seat sentinel)
agent-kit/                # Self-contained "issue -> PR" agent loop + Claude review kit (scripts, workflows, config, setup skill)
.github/workflows/        # deploy.yml (Vercel auto-deploy on push to main); agent-dispatch, claude, claude-code-review (installed from agent-kit/; see agent-kit/docs/operations.md)
```

See [AGENTS.md](./AGENTS.md) for contribution conventions (notably the styling
rules).
