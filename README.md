# Tic-Tac-Toe

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby to play across browsers or spectate a live
game.

## Features

- **Game rooms & lobby:** the landing page lists open rooms with live status and
  a board preview; create a room as two-player or vs an AI.
- **Seat claiming:** visitors claim an open X or O seat, and everyone else
  spectates. Your identity is stored per browser, and only the seat-holder whose
  turn it is can move.
- **Near-real-time play:** rooms poll the server, so moves, seat changes, and
  spectated games update within a couple of seconds. A seat auto-releases after
  30s without a heartbeat (for example, when its player closes the tab).
- **Board-extend action:** in addition to their move, each player gets one
  once-per-game action that grows the board by a row (top/bottom) or a column
  (left/right). The player must move first; after their move they may extend or
  skip (keeping the action for a later turn). A win is always three in a row on
  the resulting board, of any size.
- **AI opponent:** in a vs-AI room the computer plays O server-side with
  minimax - unbeatable on the classic 3x3 board, and depth-limited on larger
  boards. The AI may also spend its own one-time board-extend action when its
  lookahead judges it worthwhile.
- **Scoreboard** tracking wins for each side and draws across rounds.
- **Win-line highlight** and a clear turn/winner status indicator.
- **Completed games & replay:** every finished game is archived and listed on the
  lobby below the active rooms.
  Archived games can no longer be played, but each one can be replayed turn by
  turn (step forward/back, jump to start/end, or auto-play) on its own
  `/replay/[id]` page.
  The archive survives the room being reset for a new round, so a single room can
  accumulate a history of games.
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

## Project structure

```
app/                      # App Router: lobby, /room/[id], /replay/[id], styles
app/api/rooms/            # REST endpoints: list/create rooms, seats, moves,
                          #   reset, extend, skip-extend
app/api/completed/        # REST endpoints: list completed games + fetch one for replay
components/<Name>/         # One folder per component, each with styles.module.scss
lib/gameLogic.ts          # Pure game logic: dynamic-size winner detection,
                          #   board extension, and the (depth-limited) minimax AI
lib/roomStore.ts          # In-memory server store (Map on globalThis); all validation
lib/roomTypes.ts          # Shared room, seat, score, and completed-game types
lib/roomClient.ts         # Browser fetch helpers for the room API
lib/apiHelpers.ts         # Shared request/response helpers for the room API routes
lib/usePolling.ts         # Client hook: poll the server on an interval
lib/usePlayerId.ts        # Client hook: stable per-browser player id
```

See [AGENTS.md](./AGENTS.md) for contribution conventions (notably the styling
rules).
