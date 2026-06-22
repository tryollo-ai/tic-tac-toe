# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

A multiplayer tic-tac-toe app built with Next.js (App Router) and TypeScript.
Players join game rooms from a lobby and play across browsers or spectate live.
Rooms are kept in an in-memory server store (`lib/roomStore.ts`, a `Map` on
`globalThis`) and surfaced to clients via polling. A room is either two-player or
played against an unbeatable AI (minimax, in `lib/gameLogic.ts`).

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
  `lib/gameLogic.ts`, the in-memory room store and all move/seat validation in
  `lib/roomStore.ts`, shared types in `lib/roomTypes.ts`, browser fetch helpers
  in `lib/roomClient.ts`, shared request/response helpers for the API routes in
  `lib/apiHelpers.ts`, and the client hooks `usePolling`/`usePlayerId`.
- Routes, pages, and API endpoints live in `app/` (App Router); the room REST
  endpoints are under `app/api/rooms/`.

## Commands

- `npm run dev` - start the dev server
- `npm run build` - production build
- `npm run lint` - run ESLint
