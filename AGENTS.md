# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby and play across browsers or spectate live.
Rooms are kept in an in-memory server store (`lib/roomStore.ts`, a `Map` on
`globalThis`) and surfaced to clients via polling. A room is either two-player or
played against an AI (minimax, in `lib/gameLogic.ts`).

The board is not fixed at 3x3: each player has one once-per-game "extend" action
that adds a row (top/bottom) or column (left/right), so a room carries `rows`
and `cols` and a flat `board` array of `rows * cols` cells. A move is always
placed first; if the mover still has their extend action, the store sets
`awaitingExtend` to that player and holds the turn until they extend
(`extendBoardAction`) or skip (`skipExtend`). Win detection is three in a row on
any board size, with the winning lines generated per dimension in
`lib/gameLogic.ts`. Minimax is exact on 3x3 and depth-limited (with a heuristic)
on larger boards; the AI decides whether to spend its own extend via
`chooseAiExtend`. When changing board geometry or win rules, keep all of
`calculateWinner`, `winningLines`, `extendBoard`, and the store's turn/extend
state machine in sync.

Each room also records its history: `moves` (played cell indices in order) plus
`extendLog` (each extension's direction and the move count it happened at). When
a game finishes it is snapshotted into a separate completed-games archive (a
second `Map` on `globalThis`), so it can be replayed turn by turn from
`/replay/[id]` even after the room is reset for a new round or reaped for
idleness. Replay reconstructs every step via `boardAfterMoves(moves, count,
extends)`, which re-applies the extensions in order so the board grows exactly as
it did live - so the move log and extend log together are the single source of
truth, and anything that changes how moves or extensions are recorded must keep
`boardAfterMoves` able to rebuild the board.

## Styling conventions

- **No Tailwind, no global utility frameworks.** Styling is done exclusively with
  [CSS Modules](https://nextjs.org/docs/app/building-your-application/styling/css-modules)
  authored in SCSS.
- **Every component owns its styles.** Each component lives in its own folder
  under `components/` and is paired with a `styles.module.scss` file in that same
  folder. For example:

  ```
  components/
    Board/
      Board.tsx
      styles.module.scss
    Square/
      Square.tsx
      styles.module.scss
  ```

- Import styles as `import styles from "./styles.module.scss"` and reference
  classes via the `styles` object (e.g. `className={styles.board}`).
- Compose multiple/conditional classes by joining them, e.g.
  `[styles.square, isWinning ? styles.winning : ""].filter(Boolean).join(" ")`.
- **Only global styles** (CSS variables, resets, `body` defaults) live in
  `app/globals.scss`. Do not add component-specific rules there.
- Shared design tokens (colors) are defined as CSS custom properties in
  `app/globals.scss` (e.g. `var(--x-color)`); use them instead of hard-coding
  repeated values.

When adding a new component, create a new folder with both the `.tsx` file and
its own `styles.module.scss`. Do not share one stylesheet across components.

## Layout conventions

- Reusable components live in `components/<Name>/`.
- `lib/` holds non-component code: pure game logic (no React) in
  `lib/gameLogic.ts`, the in-memory room and completed-game store plus all
  move/seat validation in `lib/roomStore.ts`, shared types in `lib/roomTypes.ts`,
  browser fetch helpers in `lib/roomClient.ts`, shared request/response helpers
  for the API routes in `lib/apiHelpers.ts`, and the client hooks
  `usePolling`/`usePlayerId`.
- Routes, pages, and API endpoints live in `app/` (App Router); the room REST
  endpoints are under `app/api/rooms/` and the read-only completed-game endpoints
  under `app/api/completed/`. The replay view lives at `app/replay/[id]/`.

## Commands

- `npm run dev` - start the dev server
- `npm run build` - production build
- `npm run lint` - run ESLint
