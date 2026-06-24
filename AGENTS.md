# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby and play across browsers or spectate live.
Rooms are kept in an in-memory server store (`lib/roomStore.ts`, a `Map` on
`globalThis`) and surfaced to clients via polling. A room is either two-player or
played against an AI (minimax, in `utils/gameLogic.ts`).

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
win detection stays three in a row via `calculateWinner`.
A room carries a flat `board` of 9 cells; the grid is a fixed 3x3 square derived
from `INITIAL_SIZE`.
Minimax is exact on 3x3; as O the AI weighs its best placement against shifting
each turn via `chooseAiAction`.
When changing the shift or win rules, keep `calculateWinner`,
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
  under `common/components/` and is paired with a `styles.module.scss` file in
  that same folder. For example:

  ```
  common/
    components/
      Board/
        Board.tsx
        styles.module.scss
      Square/
        Square.tsx
        styles.module.scss
  ```

- Import styles as `import styles from "./styles.module.scss"` and reference
  classes via the `styles` object (e.g. `className={styles.root}`).
- **The component's root element uses `styles.root` as its main class.** When a
  component renders a `<div>` (or other element) as its outermost node, that
  first element's primary class is `styles.root` rather than a component-specific
  name like `styles.board`. Components whose root is not a `<div>` (e.g. `Square`,
  which renders a `<button>`) are exempt and keep their semantic root class.
  Alternate full-screen states reached via early returns (e.g. loading/not-found
  branches) keep their own semantic class; only the primary render's root uses
  `styles.root`.
- Compose multiple/conditional classes with the
  [`classnames`](https://www.npmjs.com/package/classnames) package, imported as
  `import classNames from "classnames"`. Use the object form for conditional
  classes and positional args for unconditional joins, e.g.
  `classNames(styles.square, { [styles.winning]: isWinning })` or
  `classNames(styles.root, toneClass[tone])`. Do not hand-roll
  `[...].filter(Boolean).join(" ")` or `cond ? styles.x : ""` className strings.
  (`classnames` only builds a class string from conditions; it is not a utility
  CSS framework, so it does not conflict with the no-Tailwind rule above.)
- **Only global styles** (CSS variables, resets, `body` defaults) live in
  `app/globals.scss`. Do not add component-specific rules there.
- Shared design tokens (colors) are defined as CSS custom properties in
  `app/globals.scss` (e.g. `var(--x-color)`); use them instead of hard-coding
  repeated values.

When adding a new component, create a new folder with both the `.tsx` file and
its own `styles.module.scss`. Do not share one stylesheet across components.

## Component conventions

- **Declare components as arrow-function consts**, not function declarations.
  Use `const Name = (props: Props) => { ... }` followed by a separate
  `export default Name;` at the bottom of the file, rather than
  `export default function Name(...) { ... }`. This applies to shared components
  in `common/components/` as well as the App Router `page.tsx`/`layout.tsx`
  entry points.

## Layout conventions

- Reusable components live in `common/components/<Name>/` so they can be shared
  across the app.
- `utils/` holds stateless helper modules that can be shared anywhere: pure game
  logic (no React) in `utils/gameLogic.ts`, browser fetch helpers in
  `utils/roomClient.ts`, and shared request/response helpers for the API routes
  in `utils/apiHelpers.ts`. Keep a helper's types colocated with it (e.g. the
  `Board`/`Direction`/`GameAction` types live alongside the functions in
  `utils/gameLogic.ts`).
- `lib/` holds the remaining non-component code that is not a pure helper: the
  in-memory room and completed-game store plus all move/seat validation in
  `lib/roomStore.ts`, shared types in `lib/roomTypes.ts`, and the client hooks
  `usePolling`/`usePlayerId`.
- `constants/` holds cross-cutting domain constants shared across more than one
  module - e.g. `INITIAL_SIZE` (the board side length, used by `utils/gameLogic`,
  the board components, and the store) and `AI_SEAT` (the AI seat sentinel used
  by the store), both in `constants/game.ts`. Keep module-internal tuning
  (minimax weights, store TTLs) and component-local UI timings
  (`AI_MOVE_DELAY_MS`, `AUTOPLAY_MS`, `PAGE_SIZE`) colocated with their owners
  rather than centralizing them here. A constant that is inseparable from a
  colocated type (e.g. `DIRECTIONS`, typed `readonly Direction[]`) stays with
  that type.
- Routes, pages, and API endpoints live in `app/` (App Router); the room REST
  endpoints are under `app/api/rooms/` and the read-only completed-game endpoints
  under `app/api/completed/`. The replay view lives at `app/replay/[id]/`.

## Commands

- `npm run dev` - start the dev server
- `npm run build` - production build
- `npm run lint` - run ESLint
- `npm test` - run the Vitest unit suite once (`vitest run`)

## Testing

Unit tests use [Vitest](https://vitest.dev/) and run in the `node` environment
(see `vitest.config.ts`, which mirrors the `@/*` path alias). Tests are
co-located next to the code as `*.test.ts` (e.g. `utils/gameLogic.test.ts`,
`lib/roomStore.test.ts`) and cover the pure game-state logic and the store's
turn/seat/shift validation. They are deterministic - no timers, network, or
randomness - so prefer testing exported pure functions directly; the in-memory
store can be driven straight through its exported functions (`createRoom`,
`claimSeat`, `makeMove`, `shiftBoardAction`) without a live server. Network,
polling, and React rendering are intentionally out of scope here.
