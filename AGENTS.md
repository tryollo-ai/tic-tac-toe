# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby and play across browsers or spectate live.
Rooms are kept in an in-memory server store (`lib/roomStore.ts`, a `Map` on
`globalThis`) and surfaced to clients via polling. A room is either two-player or
played against an AI (minimax, in `lib/gameLogic.ts`).

The board is a fixed 3x3, but the game is not plain tic-tac-toe: player O has one
once-per-game "shift" action that slides the whole grid one cell
(top/bottom/left/right), with any marks pushed off the leading edge removed.
This is deliberate balance - on a solved 3x3 draw, X's first move is an edge, and
O's single shift is the compensation that keeps the game fair against a human.
The shift is an alternative to placing a mark and uses up O's turn, so players
still alternate strictly: on O's turn O either places (`makeMove`) or shifts
(`shiftBoardAction`, guarded so only O, only on O's turn, only once via
`oShiftUsed`).
A shift can never complete a line (it only translates marks), so it never wins;
win detection stays three in a row via `calculateWinner`/`winningLines`.
A room still carries `rows`/`cols` (always 3) and a flat `board` of `rows * cols`
cells.
Minimax is exact on 3x3; as O the AI weighs its best placement against shifting
each turn via `chooseAiAction`.
When changing the shift or win rules, keep `calculateWinner`, `winningLines`,
`shiftBoard`, and the store's turn state machine in sync.

Each room records its history as a single ordered `actions` log, where each
action is either `{ kind: "place", index }` or `{ kind: "shift", dir }` and the
player alternates strictly (X takes the even-indexed actions, O the odd ones).
When a game finishes it is snapshotted into a separate completed-games archive (a
second `Map` on `globalThis`), so it can be replayed turn by turn from
`/replay/[id]` even after the room is reset for a new round or reaped for
idleness.
Replay reconstructs every step via `boardAfterActions(actions, count)`, which
replays the prefix of actions in order - so the action log is the single source
of truth, and anything that changes how actions are recorded must keep
`boardAfterActions` able to rebuild the board.

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
