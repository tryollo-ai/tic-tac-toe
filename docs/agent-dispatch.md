# Trigger - issue agent

An opt-in, scheduled loop that turns Kanban tickets into reviewable pull requests.

## What it does

You open tickets on the repository's GitHub issues / Project board and mark the ones you want worked.
Twice a day a workflow gathers the eligible tickets and lets a selector agent choose up to three to work this run - weighing priority, dependencies, and how much each one unblocks - then claims them and runs one agent per ticket.
Each agent implements its ticket, validates with no-mistakes, and opens a pull request.
When you want changes on one of those PRs, you `@claude`-mention it in a comment and the Claude Code app wakes an agent to address the feedback.
Nothing is ever merged automatically; every PR waits for you.

The dispatch loop is one workflow we own:

- `.github/workflows/agent-dispatch.yml` - scheduled (00:00 and 12:00 UTC) and manual; selects, claims, and fans out work.

PR follow-ups are handled by the workflows the [Claude Code GitHub installer](https://code.claude.com/docs/en/github-actions) adds, not by this loop:

- `.github/workflows/claude.yml` - event-driven; wakes an agent when you `@claude`-mention an issue or PR.
- `.github/workflows/claude-code-review.yml` - event-driven; runs an automated review when a PR is opened or updated.

Both installer workflows authenticate with the `CLAUDE_CODE_OAUTH_TOKEN` secret (your Claude subscription), and `agent-dispatch.yml` uses that same token.

## Opt-in: label **and** Ready column

A ticket is eligible **only** when all of these hold, and it is not already `agent:in-progress`, `agent:done`, or `agent:needs-help`:

1. **It carries the `agent:ready` label.** This marks the ticket as *automatable* - something the loop is allowed to touch at all.
2. **Its card sits in the board's "Ready" column** (Projects v2 Status = `Ready`, matched case-insensitively). This says *work it now*.
3. **None of its blockers is still open.** A ticket can be marked "Blocked by" another issue - via GitHub's native relationship or a `Blocked by #N` / `Depends on #N` line in its body; while any blocker is still open the ticket is held back (see [Dependencies](#dependencies-blocked-by)).

The two gates are independent and that is the point: you can keep an ordinary Project board with **no column-to-label automation**.
Label the handful of tickets you are happy to automate, and they still stay put until you drag them into Ready - a labelled ticket parked in Backlog (or any non-Ready column) is invisible to the loop.
Anything without `agent:ready` is invisible regardless of column, so you can file freely:

- **Backfilling resolved issues** - file them closed, or open without `agent:ready`; closed tickets are never pulled.
- **Tracking / non-deliverable tickets** - leave `agent:ready` off (optionally add `type:tracking`); they live on the board but the agent ignores them.

To hand a ticket to the agent, add `agent:ready` plus a `priority:*` label **and** move its card into the Ready column.

The Ready-column gate reads each labelled issue's board Status through the Projects v2 GraphQL API, using the same `PROJECTS_TOKEN` PAT as board sync (see [Board sync](#board-sync-and-the-ready-column-gate)).
It is **fail-closed**: if `PROJECTS_TOKEN` is missing, the issue is on no board, or its status cannot be read, the ticket counts as *not Ready* and is skipped - the loop never falls back to label-only and never pulls a Backlog card.
So with the Ready-column gate active, `PROJECTS_TOKEN` is required for the loop to select anything, and the project's **Status** field must offer a `Ready` option.

## Dependencies (Blocked by)

A ticket's blockers come from two sources, and both are honored.

**1. GitHub's native "Blocked by" relationships (primary).**
Open an issue, and under its **Relationships** add a "Blocked by" link to the issue it waits on (the same feature that shows the *"N tracked / blocked by"* summary on the card).
This is the recommended way: it is structured, shows in the GitHub UI, and needs nothing in the issue text. For example, marking #34 *blocked by* #41 holds #34 until #41 closes - even though #34's body never mentions #41.

**2. A `Blocked by` / `Depends on` line in the body (convenience).**
For whoever prefers to write it in prose, a line like the following is parsed too:

```
Blocked by #41
Depends on #12, #13 and #14
```

Both phrasings mean the same thing (hyphenated `blocked-by` / `depends-on` and a trailing colon are accepted; matching is case-insensitive).

Either way, a blocker is satisfied once the referenced issue is **closed**; until then the dependent ticket is held back, even if it is labelled, in the Ready column, and high priority.
This lets you queue a chain of work up front - file the whole chain `agent:ready` in Ready, link each one's blocker, and the loop naturally works it in dependency order, picking up each ticket only once the issues it waits on have merged and closed.

The gate is **fail-closed**: a blocker that is not closed - or that cannot be read at all (a native read error, an unreadable body ref, or a `totalBlockedBy` count higher than the blockers GitHub returned, e.g. a cross-repo blocker) - is treated as `UNKNOWN` and still blocks, so a ticket is never worked on an unverified prerequisite.
Tickets with no blockers from either source pass through untouched.
The body parsing (`parseBlockerRefs`) and the two-source merge (`resolveBlockedBy`) are pure functions in `scripts/agent-dispatch/dependencies.ts` (covered by `dependencies.test.ts`); the network reads - the native `blockedBy` relationships and the state of any body-only refs - are done by `enrichDependencies.cli.ts` (`yarn enrich-dependencies`), which annotates each issue with `blockedBy: [{number, state}]` for the selector.

## Selection: an agent picks, a guardrail keeps it safe

Once the eligible candidates are gathered, **an agent chooses which subset to work this run** rather than a fixed top-N slice.
It is given each candidate's priority, age, body summary, and an `unblocks` count (how many other open tickets are waiting on it), plus the per-run cap, and returns the ordered subset to work.
This lets the loop make judgment calls a static sort cannot - e.g. preferring a ticket that unblocks three others over a slightly higher-priority dead end.

The agent only **proposes**. A deterministic guardrail then trims its answer to real eligible candidate numbers, drops duplicates, preserves its order, and caps at `max` - so a hallucinated or blocked number can never reach the work matrix.
And it **always has a fallback**: if the agent is unavailable (binary missing, timeout) or returns nothing usable, selection falls back to the deterministic order - priority, highest first:

`priority:critical` > `priority:high` > `priority:med` > `priority:low` > (no priority label),

with the oldest ticket first (FIFO) within a tier so nothing starves.
The same fallback is used directly, skipping the agent, when every eligible ticket already fits under the cap (there is no subset to choose).
At most three tickets are taken per run (override with the `max` input on a manual run, or the `FM_AGENT_MAX_TICKETS` env on either selector CLI).

The pieces are pure and tested:

- `selectTickets(issues, { max, requireReadyStatus })` in `scripts/agent-dispatch/selectTickets.ts` (covered by `selectTickets.test.ts`) - eligibility (label, Ready column, **and** the dependency gate), priority/FIFO order, cap. It stays pure and offline; the board Status and `blockedBy` it gates on are injected upstream by the enrich steps. This is both the agent's guardrail and its fallback.
- `chooseTickets({ issues, max, requireReadyStatus, runAgent })` in `scripts/agent-dispatch/selectTicketsAgent.ts` (covered by `selectTicketsAgent.test.ts`) - builds the prompt, runs the injected agent, applies the guardrail, and falls back. The agent itself is wired in by the CLI as a no-tools `claude -p`, so the policy stays offline-testable.

The workflow runs the thin CLIs in sequence, each testable and runnable without the network:

1. `enrichIssueStatus.cli.ts` (`yarn enrich-issue-status`) adds each issue's board Status via the pure `getProjectStatus(...)` helper (`getProjectStatus.ts`, covered by `getProjectStatus.test.ts`). Authenticates with `PROJECTS_TOKEN`; with no token or an unreadable status it passes the issue through with no status (fail-closed).
2. `enrichDependencies.cli.ts` (`yarn enrich-dependencies`) adds each issue's resolved `blockedBy` states (see [Dependencies](#dependencies-blocked-by)).
3. `selectTicketsAgent.cli.ts` (`yarn select-tickets-agent`) reads the enriched list on stdin, lets the agent pick, applies the guardrail/fallback, and prints the chosen numbers as a compact JSON array. The workflow passes `--require-ready-status` so the column gate is on, and provides `CLAUDE_CODE_OAUTH_TOKEN` for the agent.

```sh
gh issue list --state open --label agent:ready \
  --json number,title,labels,createdAt,state,body --limit 100 \
  | yarn --silent enrich-issue-status \
  | yarn --silent enrich-dependencies \
  | yarn --silent select-tickets-agent --max 3 --require-ready-status
# -> e.g. [42,7,13]  (Ready-column, unblocked tickets the agent chose to work)
```

The deterministic `selectTickets.cli.ts` (`yarn select-tickets`) is still available and is what the agent path falls back to; swap it in for `select-tickets-agent` above for a fully deterministic, agent-free selection.

## Claiming (idempotency)

Selection is read-only: the `select` job only chooses the ticket numbers and never changes a label.
Each ticket is then claimed inside its own per-ticket job, as that job's first step: it adds `agent:in-progress` and removes `agent:ready` before any work starts.
That is the claim lock: a later run will not re-pull a ticket that is already in progress.
Keeping the claim per-ticket makes each ticket's lifecycle self-contained - one ticket failing to claim or run can never strand another.

The same per-ticket job ends with a done/park step that always runs.
If the job finishes with an open PR for `fm/issue-<number>`, the ticket is moved to `agent:done` (dropping `agent:in-progress`) and waits for you to review and merge.
If it finishes without an open PR - a failed run, a risky finding the agent stopped on, or no change needed - the ticket is moved to `agent:needs-help` and a comment is left, so it parks for you instead of being stranded in `agent:in-progress`.
The park comment is not a fixed string: it diagnoses what actually happened, quoting the agent's own final message (its reason for stopping) on a run that finished, or a "failed or timed out" message otherwise, and always links back to the run.

## Run transcript and parking diagnostics

The dispatch job reads the `execution_file` output that `claude-code-action@v1` writes (a JSON log of the run) and turns it into something readable, via the pure `agentRunReport` helper (`scripts/agent-dispatch/agentRunReport.ts`, covered by `agentRunReport.test.ts`, CLI `agentRunReport.cli.ts` / `yarn agent-run-report`):

- **Run Summary.** A `Summarize the agent run` step renders the run as a clean Claude-and-tools conversation - assistant text plus one compact line per tool call - on the run's **Summary** tab. The noisy tool-result blocks are dropped, which is both more readable than `show_full_output` and safer (those tool-result blocks were the secret-leak vector). It is `continue-on-error` and runs on `if: always()`, so it never fails the job and still summarizes a failed run.
- **Park comment.** The park step builds its comment from `extractResult(...)` (the agent's final message) plus the agent step's `outcome` and a link to the run, posting it with `gh issue comment --body-file` (the agent text is never interpolated into a shell line). A missing or partial `execution_file` (e.g. from a hard timeout) degrades to a generic message, never an empty comment.

The done/park step is deliberately resilient: it only marks the ticket `agent:done` on a *confirmed* open PR, and parks on any uncertainty (the PR check errored or returned nothing).
When a PR is open, the ticket is marked `agent:done` and the PR waits for you.
Each per-ticket job also carries a 30-minute `timeout-minutes`, so a hung agent run is cut off rather than holding a runner indefinitely; because the step runs with `if: always()`, it still fires on a timeout and the ticket is parked instead of stranded in `agent:in-progress`.

## One-time setup

1. **Labels.** Run `scripts/agent-dispatch/setup-labels.sh` (optionally `--repo owner/name`) to create the labels idempotently.
2. **Claude Code OAuth token.** Install the Claude GitHub app and run the [Claude Code GitHub installer](https://code.claude.com/docs/en/github-actions) (`/install-github-app` from the Claude Code CLI), which adds the `claude.yml` / `claude-code-review.yml` workflows and stores a `CLAUDE_CODE_OAUTH_TOKEN` repository secret (Settings -> Secrets and variables -> Actions).
   `agent-dispatch.yml` authenticates `anthropics/claude-code-action@v1` with that same token (your Claude subscription) rather than a metered API key, and passes the workflow's default `GITHUB_TOKEN` as `github_token`.
   The action's GitHub work runs under that default token, so each job that runs the action grants it `contents`/`issues`/`pull-requests: write` plus `actions: read`.

That is the whole setup. The workflows install the `no-mistakes` CLI on the runner automatically, via

```sh
curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh
```

which auto-detects the runner's platform build and puts `no-mistakes` on `PATH` - so there is no installer variable to configure.

## Board sync and the Ready-column gate

The agent loop drives issue **labels** (`agent:in-progress`, `agent:done`, `agent:needs-help`).
On a GitHub Projects v2 board, the *column* a card sits in is driven by the project's single-select **Status** field, not by labels.
The board's Status field is used in two directions, both via a `PROJECTS_TOKEN` minted at runtime from the `PROJECTS_APP` GitHub App:

- **Read (selection gate).** The selector reads each labelled issue's Status and only works tickets in the `Ready` column - see [Opt-in](#opt-in-label-and-ready-column). This is **not** optional once the gate is on: it is fail-closed, so without a working `PROJECTS_TOKEN` and a `Ready` Status option the loop selects nothing.
- **Write (board sync).** As the agent works, the workflow moves the card's Status to mirror the label lifecycle. This direction is entirely best-effort: if it is not configured the loop still runs and nothing fails.

To enable both:

1. **Secrets.** Register a GitHub App with **Projects** read+write (organization) permission, install it on this repository, and add its credentials as two repository secrets: `PROJECTS_APP_ID` and `PROJECTS_APP_PRIVATE_KEY`. Each job mints a short-lived installation token from them (via `actions/create-github-app-token`, resolved from this repo - no `owner`, which would do a user/org lookup that 404s) and passes it to the scripts as `PROJECTS_TOKEN`. The repo-scoped token still carries the app's org-level Projects permission. A GitHub App is used rather than a PAT because the default `GITHUB_TOKEN` cannot read or write user/org Projects v2, and an App token is short-lived and not tied to a single user.
2. **Status options.** On the project, the **Status** field must offer a `Ready` option (the selection gate) plus `In Progress`, `In Review`, and `Needs captain` (board sync), all matched case-insensitively.
   `Backlog` (or any other non-`Ready` column) needs no special option - it is simply "not Ready" to the gate.
   `Done` is **not** required here: the merge -> `Done` transition is handled natively by GitHub Projects' built-in "pull request merged / item closed -> Done" workflow, and tickets close via `Closes #<n>` in the PR body.

Once set up, the workflows move the card automatically:

- **Claimed** -> `In Progress` (dispatch, right after `agent:in-progress` is added).
- **PR opened** -> `In Review` (dispatch, alongside the `agent:done` label when an open PR exists for the branch).
- **Parked** -> `Needs captain` (dispatch, alongside the `agent:needs-help` label when no PR was opened).

`@claude` follow-ups on an existing PR (via the installer's `claude.yml`) do not move the card; the PR is already in `In Review` and stays there until you merge it.

The mechanics live in the pure `setProjectStatus(...)` helper (`scripts/agent-dispatch/setProjectStatus.ts`, covered by `setProjectStatus.test.ts`), called by the thin CLI `setProjectStatus.cli.ts` (also `yarn set-project-status`).
Both the CLI and the helper are non-fatal by design - a missing `PROJECTS_TOKEN`, an issue on no project, a missing `Status` field or option, or any API error logs a clear message and exits `0`.
The workflow steps additionally carry `continue-on-error: true`, so board sync can never block or fail the loop.

## Rollout

The loop is built so you can prove it before trusting the schedule:

1. Run `scripts/agent-dispatch/setup-labels.sh` and make sure the `CLAUDE_CODE_OAUTH_TOKEN` secret is in place (added by the Claude Code GitHub installer).
2. Create one disposable ticket, label it `agent:ready` + `priority:low`, and trigger `agent-dispatch` manually (Actions -> Agent issue dispatch -> Run workflow).
3. Confirm it implements, runs no-mistakes, and opens a PR. Then `@claude`-mention that PR with a change request and confirm `claude.yml` wakes and updates it.
4. Once the dry-run is clean, the twice-daily schedule is already wired; the loop runs on its own from there.

## Safety

- Nothing merges automatically - the captain merges every PR.
- PR follow-ups only fire on an explicit `@claude` mention (the installer's `claude.yml`), so the agent acts when you ask it to rather than on every comment.
- Event data (the dispatch `max` input, PR numbers) is never interpolated into a shell `run:` line; it is passed through `env:` and referenced as a quoted variable, which avoids GitHub Actions script injection.
- no-mistakes runs in full; routine findings are auto-approved, and genuinely risky or irreversible ones stop the run cleanly. Any run that ends without an open PR - a clean risky stop or an outright failure - parks the ticket to `agent:needs-help` rather than leaving it stuck in `agent:in-progress`.
