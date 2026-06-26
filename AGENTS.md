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

When a game is won, the `Board` draws a green connecting line over the three
winning cells via the `WinningLine` component (`common/components/WinningLine/`),
an absolutely-positioned SVG overlay rendered as the board's last child (the
board root is `position: relative`). Endpoints come from the pure
`winningLineCoords(line)` helper. It starts from the exact-thirds cell centers of
the first and last cells (`(col + 0.5) / size`, `(row + 0.5) / size`; since
`calculateWinner` returns each triple ordered along its line, those two ends are
correct for all eight wins), then extends each endpoint outward past its center,
along the line, toward that end cell's outer edge - controlled by
`ENDPOINT_EXTEND` (fraction of the half-cell from center to outer edge; `0.7`
reaches well into the end cells without touching the board boundary) - so the line runs
well into both end cells rather than stopping at their centers. All of this is
expressed in percentages, so it stays correct at any board size. The percentages
are deliberately gap-agnostic: with the board's `gap: 10px` the underlying cell
centers sit ~3px (`gap / 3`) off true center, an accepted approximation kept well
within the round-capped stroke in exchange for resize-safety. The overlay is
sized to the grid's cell area (`top/left: 14px; width/height: calc(100% - 28px)`,
matching the board padding) with explicit dimensions - a bare `<svg>` keeps its
intrinsic 300x150 size under `inset` alone, which would skew the percentages -
and is `pointer-events: none` so it never blocks clicks. The same overlay appears
in replay automatically because `/replay/[id]` renders the same `Board` with
`winningLine`.

The lobby/completed-game `MiniBoard` previews
(`common/components/MiniBoard/`) reuse this exact same `WinningLine` component
rather than duplicating geometry: `MiniBoard` derives the line itself by calling
`calculateWinner(props.board)?.line` (so `Lobby` and the API payloads stay
unchanged) and renders `WinningLine` as its last child. To anchor the overlay,
`MiniBoard`'s root is `position: relative`. Because the overlay's inset and
stroke are sized for the full board (`14px` padding, stroke `8`), `WinningLine`
reads both from CSS custom properties with those full-board values as
fallbacks - `--win-overlay-inset` (used for `top`/`left` and the
`calc(100% - 2 * inset)` width/height) and `--win-line-width` - and `MiniBoard`
overrides them on its root (`--win-overlay-inset: 4px` to match its `4px`
padding, `--win-line-width: 3` for its `84px` scale). A `MiniBoard` with no
three-in-a-row computes a null line and renders no overlay.

Modals use a shared `UIDialog` component (`common/components/UIDialog/`), a
client component built on [`@radix-ui/react-dialog`](https://www.radix-ui.com/primitives/docs/components/dialog)
(with the `react-icons` `IoMdClose` close icon). It takes an `isOpen`/`close`
pair plus `title`/`description`/`children`, renders into `document.body` via
`Dialog.Portal` (no custom container), and dismisses on overlay click, the close
button, or Escape. The home page (`common/components/Lobby/`) uses it for the
"How to play" dialog: a "How to play" button (`react-icons` `IoHelpCircleOutline`)
sits in a `titleRow` next to the lobby title and opens a `UIDialog` (kept in local
`howToOpen` state) that explains the rules - X moves first, O moves second and
gets the once-per-game grid shift, and what the shift does. The rules explanation
lives on the home page so players learn them before entering a room; `RoomGame`
has no help dialog. Reuse `UIDialog` for any future modal rather than hand-rolling
one.

`RoomGame` lays the board out centered between two side indicators (one per
player) in a `boardArea` grid (`minmax(0,1fr) minmax(0,300px) minmax(0,1fr)`,
collapsing to a single stacked column under 640px). Each `sidePanel` shows that
player's mark, name, and turn highlight (`sideActive`); the X panel adds a static
`Plays first` ability line and the O panel additionally shows `Grid shift:
available`/`used`, visible to both players and spectators. On
player O's own screen, when it is O's turn and the shift is unused (`canShiftNow`),
the O panel also renders the `SHIFT_OPTIONS` direction buttons so O activates the
shift directly from the indicator - X and spectators see the status but no
controls. `canShiftNow` mirrors the store's `shiftBoardAction` guard
(`mySeat === "O"`, O's turn, both seated, shift unused). There is no manual "New
Game" button: a finished game auto-resets after `AUTO_RESET_MS` via a single
seated scheduler (the X seat, falling back to O if X is empty) guarded by a ref so
the many polling clients/spectators do not double-reset, with a "Next game
starting…" line shown while it counts down.

To the left of the play area, `RoomGame` renders a `BoardHistory`
(`common/components/BoardHistory/`) column showing the game's progression - one
entry per move, oldest at top and newest at bottom. The history is the outermost
left column: `RoomGame` wraps `BoardHistory` and the existing `boardArea` in a
`playArea` grid (`minmax(0,150px) minmax(0,1fr)`) so the X/O side panels still
flank the board directly; under 900px the `playArea` collapses to one column and
the history stacks above the board (the inner `boardArea` keeps its own 640px
collapse). `BoardHistory` takes only `actions: GameAction[]` and derives each
historical board with `boardAfterActions(actions, i + 1)` (rendered through the
shared `MiniBoard`, which draws any winning line) - the same action-log
reconstruction the replay view uses, so it is never a second board renderer.
Each entry's player+move label comes from the pure `describeAction(action, index)`
helper in `utils/historyLabels.ts` (covered by `utils/historyLabels.test.ts`),
which assigns X to even indices and O to odd ones and produces a compact move
string - a named cell via `cellName` (e.g. "center", "top-left") for a placement,
or "shift <direction>" for O's grid shift. The whole panel is faded
(`opacity: 0.4`) by default and animates to full opacity on `:hover`/`:focus-within`;
its bounded list (`max-height`, hidden scrollbar) is scrolled by up/down arrow
buttons that disable at the ends, and a layout effect keeps the newest move
scrolled into view as the game advances. The panel renders nothing until there is
at least one move. Reuse `describeAction`/`cellName` for any other per-action
labeling rather than re-deriving the player-parity or cell-naming rules.

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
  under `common/components/`, with its entry file named `index.tsx` and paired
  with a `styles.module.scss` file in that same folder. For example:

  ```
  common/
    components/
      Board/
        index.tsx
        styles.module.scss
      Square/
        index.tsx
        styles.module.scss
  ```

  The folder name is the component name, and imports reference the folder (which
  resolves to `index.tsx`), e.g. `import Board from "@/common/components/Board"`.

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

When adding a new component, create a new folder with both the `index.tsx` entry
file and its own `styles.module.scss`. Do not share one stylesheet across
components.

## Component conventions

- **Declare components as arrow-function consts**, not function declarations.
  Use `const Name = (props: Props) => { ... }` followed by a separate
  `export default Name;` at the bottom of the file, rather than
  `export default function Name(...) { ... }`. This applies to shared components
  in `common/components/` as well as the App Router `page.tsx`/`layout.tsx`
  entry points.
- **Type props as a local `type Props` and read them through a single `props`
  argument.** Every component that takes props declares its prop type as a local
  `type Props = { ... }` (a `type` alias named exactly `Props`, not an
  `interface` and not `<Name>Props`), accepts one parameter `(props: Props)`
  without destructuring it in the parameter list, and accesses each field as
  `props.<field>` in the body and JSX. This applies to shared components and to
  App Router `page.tsx`/`layout.tsx` entry points alike. For example:

  ```tsx
  type Props = {
    board: Board;
  };

  const MiniBoard = (props: Props) => {
    return <div>{props.board.length}</div>;
  };
  ```

  Non-prop types a component also exports (e.g. `Scores`, `StatusTone`) keep
  their own descriptive names and `export`; only the props object uses the local
  `type Props` name.

## Layout conventions

- Reusable components live in `common/components/<Name>/` so they can be shared
  across the app.
- `utils/` holds stateless helper modules that can be shared anywhere: pure game
  logic (no React) in `utils/gameLogic.ts`, browser fetch helpers in
  `utils/roomClient.ts`, and shared request/response helpers for the API routes
  in `utils/apiHelpers.ts`, and the pure winning-line overlay geometry in
  `utils/winningLineGeometry.ts`. Keep a helper's types colocated with it (e.g.
  the `Board`/`Direction`/`GameAction` types live alongside the functions in
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

- `yarn dev` - start the dev server
- `yarn build` - production build
- `yarn lint` - run ESLint
- `yarn test` - run the Vitest unit suite once (`vitest run`)
- `yarn deploy` - deploy to Vercel production (`vercel --prod`)
- `yarn select-tickets` - run the deterministic agent-dispatch ticket selector
  CLI (reads a `gh issue list` JSON payload on stdin, prints the chosen issue
  numbers by priority/FIFO); also the guardrail/fallback behind the agent selector
- `yarn select-tickets-agent` - run the agent-driven selector CLI: hands the
  eligible candidates to `claude`, then applies the deterministic guardrail and
  falls back to `select-tickets` if the agent is unavailable
- `yarn enrich-issue-status` - annotate the issue JSON on stdin with each
  issue's Projects v2 board Status for the selector's Ready-column gate
  (fail-closed; no-ops to label-only data without `PROJECTS_TOKEN`)
- `yarn enrich-dependencies` - annotate the issue JSON on stdin with each
  issue's resolved `blockedBy` states for the selector's dependency gate: GitHub's
  native "Blocked by" relationships plus any "Blocked by #N" / "Depends on #N" in
  the body (fail-closed; a blocker that is not CLOSED, or cannot be read, blocks)
- `yarn set-project-status` - run the best-effort Projects v2 board-sync CLI
  (`--issue N --status "In Progress"`; non-fatal, no-ops without `PROJECTS_TOKEN`)

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

## Agent issue loop (CI)

An opt-in, scheduled "issue -> PR" loop lives under `.github/workflows/` and
`scripts/agent-dispatch/`; it is independent of the game runtime. The captain labels
issues `agent:ready` (plus a `priority:*`) **and** drags their card into the
board's "Ready" column; twice daily `agent-dispatch.yml` gathers the eligible,
dependency-annotated candidates and lets a `claude` selector agent choose up to
three (a deterministic guardrail trims its pick to real eligible numbers and
falls back to a priority/FIFO slice if the agent is unavailable), claims each
(`agent:in-progress`, drop `agent:ready`), runs one agent per ticket on branch
`fm/issue-<n>`, and lets `/no-mistakes` open the PR. PR follow-ups are handled by
the Claude Code GitHub installer's own workflows (`claude.yml`, which wakes an
agent on an `@claude` mention, and `claude-code-review.yml`), not by a workflow we
own. Nothing is ever merged automatically. Full operator docs are in
`docs/agent-dispatch.md`.

Conventions worth preserving when touching this code:

- **Eligibility/ordering is a pure, tested TS function.** `scripts/agent-dispatch/selectTickets.ts`
  exposes `selectTickets(issues, { max, requireReadyStatus })` (opt-in gate,
  priority order, FIFO tiebreak, cap) and `filterEligible(...)`, covered by
  `selectTickets.test.ts`. Keep all eligibility/ordering logic in the pure module,
  not in YAML.
- **An agent picks the subset; a deterministic guardrail keeps it safe.** Rather
  than a fixed `slice(max)`, the `select` job hands the eligible, dependency-
  annotated candidates to `claude` and lets it choose the subset (weighing
  priority, how many other tickets each one `unblocks`, and the cap). This lives
  in the pure, tested `selectTicketsAgent.ts` (`chooseTickets`, covered by
  `selectTicketsAgent.test.ts`): the agent only *proposes*, and `applyGuardrail`
  trims its answer to real eligible candidate numbers, de-dupes, preserves order,
  and caps at `max`. The agent runs as an injected `runAgent` (the CLI
  `selectTicketsAgent.cli.ts` / `yarn select-tickets-agent` wires in the real
  `claude -p`, no tools), so the policy stays offline-testable. **Always falls
  back** to `selectTickets` when the agent adds no value (everything already fits)
  or returns nothing usable (binary missing, timeout, garbage) - the loop never
  stalls on the agent. The selector needs `CLAUDE_CODE_OAUTH_TOKEN`.
- **Dependency gate: hold back blocked tickets, fail closed.** A ticket's blockers
  come from two sources, both honored: GitHub's **native "Blocked by" relationships**
  (set in the issue UI, read via GraphQL `Issue.blockedBy` - the primary source),
  and any `Blocked by #N` / `Depends on #N` written in the **body** (parsed by the
  pure, tested `parseBlockerRefs`, comma/"and"/"&"-joined, case-insensitive, hyphen
  or space). `enrichDependencies.cli.ts` (`yarn enrich-dependencies`) reads the
  native `blockedBy` nodes (which carry each blocker's state) and `totalBlockedBy`
  count, resolves any body-only refs' state, and merges them via the pure, tested
  `resolveBlockedBy` into `blockedBy: [{number,state}]`; `selectTickets` then drops
  any issue with a blocker that is not `CLOSED`. **Fail closed:** a native read
  error, a body ref whose state can't be read, or a `totalBlockedBy` greater than
  the blockers actually returned (cross-repo / paged out) all yield `UNKNOWN`
  blockers that still block (`UNRESOLVED_BLOCKER` marks a padded/unreadable one).
  The `select` job pipes `gh issue list` (now including `body`) -> enrich-status
  -> enrich-dependencies -> the agent selector. Keep parsing and merging pure and
  offline; only the `blockedBy`/state reads touch the network (in the CLI).
- **Two independent eligibility gates: the `agent:ready` label and the "Ready"
  board column.** The label (read by `gh issue list --label`) marks a ticket
  automatable; the column (Projects v2 `Status == "Ready"`, case-insensitive)
  says work it now. With `requireReadyStatus`, `selectTickets` drops any issue
  whose `status` is not `Ready`, treating unknown/missing status as not Ready
  (**fail closed** - never auto-pick a card we cannot place in Ready). The status
  is read by the pure `getProjectStatus` helper (`getProjectStatus.ts`, tested by
  `getProjectStatus.test.ts`) and injected onto each issue by the thin
  `enrichIssueStatus.cli.ts` (`yarn enrich-issue-status`) *before* selection,
  so `selectTickets` itself stays pure and offline. The dispatch `select` job
  pipes `gh issue list` -> enrich -> `selectTickets.cli --require-ready-status`.
  Both Projects v2 CLIs share one fetch-backed executor, `makeGithubGraphql`
  (`githubGraphql.ts`), authenticated with `PROJECTS_TOKEN`. Unlike board sync,
  this read is a real gate: with no `PROJECTS_TOKEN` (or no `Ready` option) the
  loop selects nothing rather than falling back to label-only.
- **Read-only select, per-ticket claim, resilient done/park.** The dispatch `select`
  job never mutates labels; each `work` job claims as its first step and, with
  `if: always()`, marks the ticket `agent:done` when a PR for its branch is
  *confirmed* open, otherwise parks it to `agent:needs-help` (park on any
  uncertainty - never strand a claim).
- **Run diagnostics from the execution_file, in tested TS.** The dispatch job
  reads `claude-code-action@v1`'s `execution_file` output through the pure
  `agentRunReport` helper (`scripts/agent-dispatch/agentRunReport.ts`, tested by
  `agentRunReport.test.ts`, CLI `agentRunReport.cli.ts` / `yarn
  agent-run-report`): `formatTranscript` renders a clean Claude-and-tools
  conversation (tool-result blocks dropped) onto the run Summary, and
  `extractResult` + `formatParkComment` build the park comment from the agent's
  own final message (its reason for stopping) keyed off the agent step's
  `outcome`, posted via `--body-file`. All of it is defensive: a missing,
  partial, or malformed `execution_file` (e.g. a timed-out run) degrades to a
  generic message, never an error or an empty comment. There is no `conclusion`
  output in v1 - detect success/failure via `steps.<id>.outcome`. Do not bring
  back `show_full_output`; the transcript replaces it and avoids leaking the
  secrets those tool-result blocks could carry.
- **No event data in shell.** Never interpolate `github.event.*` (or `matrix.*`)
  into a `run:` line; pass it through `env:` and reference the quoted variable, to
  avoid Actions script injection. Validate the numeric `max` input in the CLI.
- **OAuth-token auth (subscription).** `agent-dispatch.yml` authenticates
  `anthropics/claude-code-action@v1` with the `CLAUDE_CODE_OAUTH_TOKEN` secret (a
  Claude subscription token, added by the Claude Code GitHub installer and shared
  with the installer's `claude.yml` / `claude-code-review.yml`) plus the workflow's
  default `GITHUB_TOKEN` (passed as `github_token: ${{ github.token }}`). Each job
  that runs the action grants it `actions: read` alongside the existing
  `contents`/`issues`/`pull-requests: write`.
- **`anthropics/claude-code-action` is intentionally left at `@v1`.** It is a
  composite action with no node runtime, so the node20→node24 deprecation cycle
  that drove the other action version bumps does not apply to it.
- The `no-mistakes` CLI is installed on the runner by the dispatch workflow's
  "Install no-mistakes CLI" step (the hardcoded `docs/install.sh` curl one-liner);
  the only one-time setup is the `CLAUDE_CODE_OAUTH_TOKEN` secret (from the Claude
  Code GitHub installer) and running `scripts/agent-dispatch/setup-labels.sh`
  (idempotent, plain `gh`) to create labels.
- **Board sync is best-effort and label-independent.** Projects v2 columns are
  driven by the project's single-select `Status` field, not by labels, so the
  workflows also call the pure `setProjectStatus(...)` helper
  (`scripts/agent-dispatch/setProjectStatus.ts`, tested by `setProjectStatus.test.ts`,
  CLI `setProjectStatus.cli.ts` / `yarn set-project-status`) to move the card:
  `In Progress` after claim, `In Review` when a PR is open, `Needs captain` on the
  park path. It authenticates with a `PROJECTS_TOKEN` that each job mints at
  runtime from the `PROJECTS_APP` GitHub App (`PROJECTS_APP_ID` +
  `PROJECTS_APP_PRIVATE_KEY`, via `actions/create-github-app-token`) because the
  default `GITHUB_TOKEN` cannot write user/org Projects v2, and matches the
  `Status` option name case-insensitively. The helper, its CLI,
  and the workflow steps (`continue-on-error: true`) are all non-fatal: a missing
  token, no project, a missing option, or any API error logs and no-ops, never
  failing the loop. `Done` is intentionally not driven here - GitHub Projects'
  native "PR merged / item closed -> Done" workflow handles it via `Closes #<n>`.
  Note the same `PROJECTS_TOKEN` is *also* used to read the `Status` for the
  Ready-column selection gate above; that read is fail-closed, so unlike this
  write path it is not optional once `requireReadyStatus` is on (the project then
  needs a `Ready` Status option alongside `In Progress`/`In Review`/`Needs captain`).
