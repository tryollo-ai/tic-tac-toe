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
- **Unbeatable AI:** in a vs-AI room the computer plays O server-side using the
  minimax algorithm, so the best you can do against it is draw.
- **Scoreboard** tracking wins for each side and draws across rounds.
- **Win-line highlight** and a clear turn/winner status indicator.
- Responsive, dark-themed UI styled with **SCSS CSS Modules** (no Tailwind).

Room state lives in an in-memory server store with no external dependencies, so
all rooms reset when the server restarts.

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
app/                      # App Router: lobby page, /room/[id], global styles
app/api/rooms/            # REST endpoints: list/create rooms, seats, moves, reset
components/<Name>/         # One folder per component, each with styles.module.scss
lib/gameLogic.ts          # Pure game logic: winner detection + minimax AI
lib/roomStore.ts          # In-memory server store (Map on globalThis); all validation
lib/roomTypes.ts          # Shared room, seat, and score types
lib/roomClient.ts         # Browser fetch helpers for the room API
lib/apiHelpers.ts         # Shared request/response helpers for the room API routes
lib/usePolling.ts         # Client hook: poll the server on an interval
lib/usePlayerId.ts        # Client hook: stable per-browser player id
```

See [AGENTS.md](./AGENTS.md) for contribution conventions (notably the styling
rules).
