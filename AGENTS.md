# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

Multiplayer tic-tac-toe: Next.js (App Router) + TypeScript.
Players join rooms from a lobby and play across browsers or against an AI, can spectate live, and replay completed games.

Architecture:
- **Game logic** (pure, no React): `utils/gameLogic.ts`. The board is a fixed 3x3, stored as a flat 9-cell array.
- **Store**: `lib/roomStore.ts` - Prisma/Postgres-backed (Neon in prod), fully async, every mutation transactional and row-locked. Schema in `prisma/schema.prisma`; cached Prisma client in `lib/prisma.ts`; domain types in `lib/roomTypes.ts`. DB setup: [docs/database.md](./docs/database.md).
- **API**: `app/api/rooms/**` and read-only `app/api/completed/**` (both endpoints require `?playerId=` and scope results to that player); shared helpers in `utils/apiHelpers.ts`.
- **Replay**: `app/replay/[id]/`.

Store invariants:
- Every read-modify-write is row-locked, so per-room mutations are serialized; a finished game is scored and archived in the same transaction, capturing the seat holders so each game is permanently attributed to its participants.
- `status` and `winningLine` are derived at serialization, never stored.
- Domain types use epoch-ms numbers; conversion to/from Postgres `timestamptz` happens only at the store boundary.

Game rules (not plain tic-tac-toe):
- Player O has one once-per-game **shift** that slides the whole grid one cell (marks pushed off the edge are removed). It consumes O's turn instead of placing and can never complete a line, so it never wins. This is deliberate balance for X's first-move edge advantage.
- After each completed game in a two-player room, `resetGame` calls `swapSeats` to exchange the X and O seat holders (and their heartbeats and accumulated scores), so the first-move advantage alternates each round. AI rooms are excluded — O is permanently the computer and the AI turn logic is keyed to the O seat.
- When changing the rules, keep the win check, the shift, the seat swap, and the store's turn state machine in sync.

History & replay:
- Each room records one ordered actions log (a place or a shift per turn, X on even indices and O on odd); the board is rebuilt by replaying a prefix of that log - the single source of truth for both history and replay. Per-action labels come from `utils/historyLabels.ts`; reuse it. Use `describeAction` for the compact history-panel label (player + short move) and `actionSentence` for the full-sentence replay caption ("X marked center" / "O shifted the grid left").

Reuse the shared components rather than duplicating them: `UIDialog` for any modal, `MiniBoard` for board previews, `WinningLine` for the win-line overlay, and `Spinner` for first-fetch loading states (all under `common/components/`). The "How to play" dialog lives on the lobby, not in `RoomGame`.

## Client data fetching

All client reads/writes go through TanStack React Query (`@tanstack/react-query`), never a hand-rolled hook; add a query/mutation for new client I/O.
- One `QueryClient` is created in `app/providers.tsx` and wraps the app in `app/layout.tsx`. Its defaults match the old polling: no retry, no refetch on window focus.
- `utils/roomClient.ts` is the thin fetch layer; React Query calls into it. Reads poll on an interval (lobby 3000ms, completed 5000ms) and abort in-flight GETs on unmount; replay fetches once. `subscribeRoom` opens an SSE connection to `GET /api/rooms/[id]/stream` for live room pushes.
- `RoomGame` is the one optimistic consumer: it subscribes to the room's SSE stream via `useRoomStream` (`lib/useRoomStream.ts`) and pauses both the stream handler and polling during writes so pushed snapshots can't clobber optimistic state. Room polling runs at 1500ms when the stream isn't connected and slows to 10s while the stream is live (safety net only).

## Styling conventions

- **No Tailwind / utility CSS frameworks.** CSS Modules in SCSS only.
- **Every component owns its styles**: `common/components/<Name>/{index.tsx, styles.module.scss}`; import the folder (`@/common/components/Board`).
- The primary render's root element uses `styles.root`. Components whose root isn't a `<div>` (e.g. `Square`'s `<button>`) and early-return states (loading/not-found) keep their semantic class.
- Compose classes with `classnames` (`import classNames from "classnames"`): object form for conditional, positional args for joins. Don't hand-roll ternary or `.join(" ")` class strings.
- Only global styles (CSS vars, resets, `body`) live in `app/globals.scss`. Design tokens are CSS custom properties there (e.g. `var(--x-color)`) - use them, don't hard-code.

## Component conventions

- **Arrow-function consts**, not function declarations: `const Name = (props: Props) => {...}` plus a separate `export default Name;`. Applies to `common/components/` and App Router `page.tsx`/`layout.tsx`.
- **Props as a local `type Props`** (exact name `Props`, not `interface`, not `<Name>Props`): one `props` param, not destructured, accessed as `props.<field>`. Other exported types keep their descriptive names.

## Layout conventions

- `common/components/<Name>/` - reusable components.
- `utils/` - stateless/pure helpers; colocate each helper's types with it.
- `lib/` - non-pure, non-component code (the store, the Prisma singleton, shared types, the player-id hook, the room-stream hook).
- `constants/` - cross-cutting domain constants shared by more than one module. Keep module-internal tuning and component-local UI timings colocated with their owners.
- `app/` - routes, pages, and API endpoints (App Router).

## Commands

- `yarn dev` - dev server
- `yarn build` - production build
- `yarn lint` - ESLint
- `yarn test` - Vitest unit suite once (`vitest run`)
- `yarn deploy` - deploy to Vercel production
- `yarn db:migrate` / `db:migrate:dev` / `db:generate` - apply migrations (CI/prod) / author a migration (dev) / regenerate the Prisma client
- Agent-dispatch CLIs live in the self-contained kit at `agent-kit/scripts/*.cli.ts` (run via `npx tsx`, no `package.json` aliases); see [agent-kit/](./agent-kit/)

## Testing

- Vitest in the `node` env (`vitest.config.ts`, mirrors the `@/*` alias). Tests are co-located as `*.test.ts`; prefer testing pure functions directly.
- Store tests run against a **throwaway Postgres in Docker**, never a real/Neon DB: `test/globalSetup.ts` starts a disposable container, applies migrations, points the env at it, and tears down after; tables are truncated between tests. **Requires a running Docker daemon.**
- GitHub Actions does not run `yarn test`; the suite runs locally / via the no-mistakes gate.

## Agent issue loop (CI)

An opt-in, scheduled "issue -> PR" loop packaged as the self-contained **agent-kit** (`agent-kit/`), independent of the game runtime. The installed workflow is `.github/workflows/agent-dispatch.yml`; its scripts/config/docs live under `agent-kit/`. Nothing is ever merged automatically. Full operator docs: [agent-kit/docs/operations.md](./agent-kit/docs/operations.md); setup: [agent-kit/SKILL.md](./agent-kit/SKILL.md).

Conventions to preserve when touching it:
- Keep all eligibility/ordering/dependency logic in pure, tested TS modules under `agent-kit/scripts/`, never in YAML; each pairs a `*.test.ts` with a thin `*.cli.ts`.
- The kit is the canonical source: workflow YAMLs live in `agent-kit/workflows/` and are copied verbatim (with `agent-kit/` script paths) into `.github/workflows/`. Edit the kit copy, then re-sync. Project-specific bits (DB `services:`, `db:migrate`, dev port, stack-conventions line) are fenced `PROJECT-SPECIFIC` in the YAML.
- Two eligibility gates, both **fail-closed**: the `agent:ready` label and the Projects v2 "Ready" column. The dependency gate also holds back any ticket with a non-`CLOSED` or unreadable blocker.
- An agent only *proposes* the ticket subset; a deterministic guardrail trims it to real eligible numbers and always falls back to the deterministic selector when the agent is unavailable.
- Resilient claim/park: the `select` job never mutates labels; each `work` job claims first and (with `if: always()`) marks `agent:done` only when a PR is confirmed open, else parks `agent:needs-help`.
- **no-mistakes runs as its own `work`-job step, never inside the agent's turn.** The agent only implements, screenshots, and commits; a following step drives `no-mistakes axi run --yes --skip ci` to a terminal outcome - CI is skipped so the loop ships a reviewable PR without holding a runner idle on GitHub Actions checks (they run independently and a human reviews them before merge). The agent's `Bash` tool hard-caps at 10 min and auto-backgrounds longer calls, which silently kills the pipeline in headless `claude -p` - so the full review/test/docs run must live in a plain `run:` step bounded only by `timeout-minutes`. The agent's DB (Postgres `service`) and intent handoff (`INTENT_FILE`) exist to support this split. Branches are `agent/issue-<n>/<slug>-<hash>` (5-char run-id+attempt hash) so a re-run never collides with a prior run's branch. When no-mistakes does not ship but commits exist, a fallback step opens a PR anyway with a Claude-drafted body under a `[!WARNING]` banner, rather than parking with nothing reviewable.
- **No event data in shell**: never interpolate `github.event.*`/`matrix.*` into a `run:` line; pass via `env:` and reference the quoted variable.
- Auth: the workflow uses `CLAUDE_CODE_OAUTH_TOKEN` + the default `GITHUB_TOKEN`; Projects v2 writes need a `PROJECTS_TOKEN` minted from the `PROJECTS_APP` GitHub App. Board sync is best-effort/non-fatal. `claude-code-action` stays at `@v1` (composite action, no node runtime).

## Evidence (no-mistakes PRs)

When a PR cites evidence (screenshots, transcripts, logs):
- **Commit it in the repo.** Write artifacts under `.no-mistakes/evidence/<branch-or-issue>/`, commit, push, and link the GitHub blob URL pinned to the commit SHA. Never link a `/tmp/...` or other local-only path - it is dead for every reviewer.
- **Never gitignore `.no-mistakes/`** - that tree is tracked on purpose, and ignoring it silently stops all future evidence from being committed. Only `/ticket.json`, `/execution.ndjson`, and `/.ticket-attachments/` are ignored.
- **Capture UI evidence from the real running app**, not a hand-written HTML mock - mocks drift from the real design tokens in `app/globals.scss` (X is sky-blue, O is rose, not framework-default red/blue). A real dev-server screenshot shows the Next.js dev indicator; a mock does not.
