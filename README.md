# Trick-Tac-Toe

A multiplayer trick-tac-toe app (a tic-tac-toe variant) built with Next.js
(App Router) and TypeScript.
Players join game rooms from a lobby to play across browsers or spectate a live
game.

## Features

- **Game rooms & lobby:** the landing page lists open rooms with live status and
  a board preview; create a room as two-player, vs an AI, or Local (pass-and-play
  on one device). The list is paginated
  (6 rooms per page) with Previous/Next navigation once there is more than one
  page. A "How to play" button by the title opens a dialog explaining the rules,
  including player O's trick, before you enter a room. The dialog ends with
  a looping animation illustrating the trick: a directional arrow sweeps across a
  mini-board, marks slide one cell, and marks pushed off the leading edge fall
  away. The animation respects `prefers-reduced-motion`.
- **Seat claiming:** visitors claim an open X or O seat, and everyone else
  spectates. Your identity is stored per browser, and only the seat-holder whose
  turn it is can move.
- **Invite player:** a button in the room sidebar copies a shareable link to the
  room to the clipboard so a seated player or spectator can pass it to someone
  else to join or spectate. The link is built from the current page's origin
  (`window.location.origin + /room/<id>`), so it stays correct across
  environments (localhost, preview, prod). The button shows a transient "Link
  copied!" confirmation for 1.5 s, then reverts. It is rendered unconditionally
  alongside the seat-claim and leave buttons, so it is always available regardless
  of role. The button is only present in live rooms, not the read-only replay view.
- **Near-real-time play:** rooms receive live pushes over a Server-Sent Events
  stream (`GET /api/rooms/[id]/stream`), so moves and seat changes appear for
  everyone within ~1–2 seconds. Polling falls back to 10s while the stream is
  connected and reverts to 1.5s if the stream can't connect (e.g. a buffering
  proxy), so updates always flow. A seat auto-releases after 30s without a
  heartbeat (for example, when its player closes the tab).
- **Live viewer count:** a "👁 N watching" badge in the room shows how many people
  (seated players and spectators) currently have the room open. Presence is
  heartbeated on every SSE stream tick and polling-fallback request; the count
  drops immediately when a viewer's stream disconnects rather than waiting out the
  12-second TTL. The badge only appears for online multiplayer rooms; single-device
  local/AI games omit it.
- **Trick action (O only):** to offset X's first-move advantage, player O
  gets one once-per-game trick that slides the whole 3x3 grid one cell (up/down/left/right).
  Any marks pushed off the leading edge are removed, and empty cells enter
  behind.
  When the trick lands, every remaining mark slides in from the cell it came
  from so the move reads as a single coherent motion; the animation plays
  identically for both players and any spectators.
  Playing a trick is an alternative to placing a mark and uses up O's turn, so O
  weighs reshaping the board against taking a square.
  A win is always three in a row.
- **AI opponent:** in a vs-AI room both seats start open; use the seat buttons to
  pick X or O and the AI claims the opposite seat instantly. The computer plays
  either side server-side with minimax and never loses on the 3x3 board. When the
  AI holds O it also decides when to spend the one-time trick, weighing it
  against its best placement each turn. Leaving your seat fully resets the round
  so the next visitor can pick either side again.
- **Local pass-and-play:** in a Local room one player claims both seats with a
  single "Play" button and takes turns for X and O on the same device — pass the
  screen after each move. The lobby shows "1 player (X & O)" once the room is
  claimed. Seats never swap between rounds (scores stay pinned to each mark), and
  leaving the room abandons the game and resets the scores, just like leaving an
  AI room.
- **Move history:** one mini-board snapshot per move, oldest first and newest
  last, each labelled with who moved and what they did (a named cell or O's
  trick). On desktop it appears as a faded column to the left of the board,
  fades up to full visibility on hover, and scrolls within a bounded height via
  up/down arrow buttons. On mobile (≤760px) it sits below the board as a
  horizontally scrolling strip; the up/down arrows are hidden and native swipe
  scrolling is used instead, so a growing history never pushes the board down
  the page.
- **Scoreboard** tracking wins for each side and draws across rounds.
- **Mark alternation:** after each completed game the two players swap marks —
  whoever held X (and moved first) becomes O for the next round, so the
  first-move advantage alternates. Players keep their seats through the swap;
  only the mark changes. An animated "New round" banner appears over the board
  announcing each player's new mark. Only two-player rooms alternate; vs-AI
  rooms and Local rooms do not (in AI rooms O is permanently the computer; in
  Local rooms one player holds both seats, so swapping is meaningless).
- **Win-line highlight:** the three winning cells are highlighted and a green
  line is drawn connecting them, alongside a clear turn/winner status indicator.
  The same overlay appears in replay and over a completed three-in-a-row in the
  lobby and completed-game board previews.
- **Win/loss/draw record:** the lobby shows a "Your record" bar above the
  room-creation form, tallying wins, losses, and draws across all archived games
  the current player took part in. The tally is derived on the server from the
  same completed-games archive (no separate counter table) and polled every 5 s.
  The bar is hidden until the player has finished at least one game, so
  first-time visitors don't see an empty 0/0/0 panel.
- **Completed games & replay:** every finished game is archived; the lobby lists
  only the games the current browser's player took part in ("Your completed
  games").
  Archived games can no longer be played, but each one can be replayed turn by
  turn (step forward/back, jump to start/end, or auto-play) on its own
  `/replay/[id]` page.
  Each forward step is animated: placed marks drop in, and O's trick plays
  the same sliding-mark animation as the live game, accompanied by a transient
  directional arrow that sweeps and fades across the board.
  A caption below the board narrates every move ("X marked center" /
  "O tricked the grid left") so a trick turn is never mistaken for a skipped move.
  Jumps and backward steps show the position with no motion; animations and the
  directional arrow are suppressed under `prefers-reduced-motion`.
  The archive survives the room being reset for a new round, so a single room can
  accumulate a history of games. A finished game auto-resets to a fresh round
  after a short delay (no manual button); a "Next game starting…" label and a
  shrinking countdown bar show all players and spectators how long remains.
  The bar animation is disabled under `prefers-reduced-motion`.
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
app/api/stats/            # REST endpoint: per-player win/loss/draw record (GET ?playerId=)
app/api/internal/         # Internal POC endpoints: game-config (GET/POST shift mode)
app/internal/             # Internal POC pages: /internal/game-config toggle UI
common/components/<Name>/ # One folder per shared component: index.tsx entry + styles.module.scss
utils/gameLogic.ts        # Pure game logic: winner detection, O's whole-grid
                          #   shift (classic + collapse modes), and the minimax AI
utils/roomClient.ts       # Browser fetch helpers for the room API; `subscribeRoom` opens an SSE stream
utils/apiHelpers.ts       # Shared request/response helpers for the room API routes
utils/winningLineGeometry.ts # Pure winning-line overlay geometry (cell-center percentages)
utils/historyLabels.ts    # Pure move-history labels: player parity, cell/trick names (`describeAction`), and full-sentence replay captions (`actionSentence`)
lib/roomStore.ts          # In-memory server store (Map on globalThis); all validation
lib/gameConfig.ts         # Server-side POC config singleton (active ShiftMode); globalThis-backed, not persisted
lib/roomTypes.ts          # Shared room, seat, score, completed-game, and player-stats types
lib/usePlayerId.ts        # Client hook: stable per-browser player id
lib/useRoomStream.ts      # Client hook: SSE subscription for live room updates
lib/useStepCue.ts         # Client hook: derive a one-shot board-animation cue the render a step counter changes
lib/useReducedMotion.ts   # Client hook: track `prefers-reduced-motion`, shared by the board/shift animations
app/providers.tsx         # Client root: stable React Query QueryClientProvider
constants/game.ts         # Cross-cutting domain constants (board size, AI seat sentinel)
agent-kit/                # Self-contained "issue -> PR" agent loop + Claude review kit (scripts, workflows, config, setup skill)
.github/workflows/        # deploy.yml (Vercel auto-deploy on push to main); agent-dispatch, claude, claude-code-review (installed from agent-kit/; see agent-kit/docs/operations.md)
```

See [AGENTS.md](./AGENTS.md) for contribution conventions (notably the styling
rules).
