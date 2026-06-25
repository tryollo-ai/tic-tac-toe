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
- **Near-real-time play:** rooms poll the server, so moves, seat changes, and
  spectated games update within a couple of seconds. A seat auto-releases after
  30s without a heartbeat (for example, when its player closes the tab).
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
- **Move history:** a faded column to the left of the board shows the game's
  progression - one mini-board snapshot per move, oldest at top and newest at
  bottom, each labelled with who moved and what they did (a named cell or O's
  grid shift). It fades up to full visibility on hover and scrolls within a
  bounded height via up/down arrow buttons.
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
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` - start the development server
- `npm run build` - create a production build
- `npm run start` - run the production build
- `npm run lint` - lint the codebase
- `npm test` - run the Vitest unit suite once

## Project structure

```
app/                      # App Router: lobby, /room/[id], /replay/[id], styles
app/api/rooms/            # REST endpoints: list/create rooms, seats, moves,
                          #   reset, shift
app/api/completed/        # REST endpoints: list completed games + fetch one for replay
common/components/<Name>/ # One folder per shared component: index.tsx entry + styles.module.scss
utils/gameLogic.ts        # Pure game logic: winner detection, O's whole-grid
                          #   shift, and the minimax AI
utils/roomClient.ts       # Browser fetch helpers for the room API
utils/apiHelpers.ts       # Shared request/response helpers for the room API routes
utils/winningLineGeometry.ts # Pure winning-line overlay geometry (cell-center percentages)
utils/historyLabels.ts    # Pure move-history labels: player parity + cell/shift names
lib/roomStore.ts          # In-memory server store (Map on globalThis); all validation
lib/roomTypes.ts          # Shared room, seat, score, and completed-game types
lib/usePolling.ts         # Client hook: poll the server on an interval
lib/usePlayerId.ts        # Client hook: stable per-browser player id
constants/game.ts         # Cross-cutting domain constants (board size, AI seat sentinel)
```

See [AGENTS.md](./AGENTS.md) for contribution conventions (notably the styling
rules).
