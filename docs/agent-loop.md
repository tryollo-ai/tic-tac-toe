# Agent issue loop

An opt-in, scheduled loop that turns Kanban tickets into reviewable pull requests.

## What it does

You open tickets on the repository's GitHub issues / Project board and mark the ones you want worked.
Twice a day a workflow picks up to three of those tickets by priority, claims them, and runs one agent per ticket.
Each agent implements its ticket, validates with no-mistakes, and opens a pull request.
When you want changes on one of those PRs, you `@claude`-mention it in a comment and the Claude Code app wakes an agent to address the feedback.
Nothing is ever merged automatically; every PR waits for you.

The dispatch loop is one workflow we own:

- `.github/workflows/agent-dispatch.yml` - scheduled (00:00 and 12:00 UTC) and manual; selects, claims, and fans out work.

PR follow-ups are handled by the workflows the [Claude Code GitHub installer](https://code.claude.com/docs/en/github-actions) adds, not by this loop:

- `.github/workflows/claude.yml` - event-driven; wakes an agent when you `@claude`-mention an issue or PR.
- `.github/workflows/claude-code-review.yml` - event-driven; runs an automated review when a PR is opened or updated.

Both installer workflows authenticate with the `CLAUDE_CODE_OAUTH_TOKEN` secret (your Claude subscription), and `agent-dispatch.yml` uses that same token.

## Opt-in by label

A ticket is eligible **only** while it carries the `agent:ready` label and is not already `claude:in-progress` or `claude:needs-captain`.
Anything without `agent:ready` is invisible to the loop, so you can file freely:

- **Backfilling resolved issues** - file them closed, or open without `agent:ready`; closed tickets are never pulled.
- **Tracking / non-deliverable tickets** - leave `agent:ready` off (optionally add `type:tracking`); they live on the board but the agent ignores them.

To hand a ticket to the agent, add `agent:ready` plus a `priority:*` label.
On a Project board, drive these as columns/fields so dragging a card into "Ready for agent" applies the label.

## Selection order

Eligible tickets are ordered by priority, highest first:

`priority:critical` > `priority:high` > `priority:med` > `priority:low` > (no priority label).

Within a priority tier, the oldest ticket goes first (FIFO), so nothing starves.
At most three tickets are taken per run (override with the `max` input on a manual run, or the `FM_AGENT_MAX_TICKETS` env on the selector CLI).

The selection logic is a pure TypeScript function, `selectTickets(issues, { max })`, in `scripts/agent-loop/selectTickets.ts`, covered by `scripts/agent-loop/selectTickets.test.ts` (run with `npm test`).
The workflow calls it through the thin CLI wrapper `scripts/agent-loop/selectTickets.cli.ts` (also exposed as `npm run select-tickets`), which reads the issue list as JSON on stdin and prints the chosen numbers as a compact JSON array - so it is testable and runnable without the network:

```sh
gh issue list --state open --label agent:ready \
  --json number,title,labels,createdAt,state --limit 100 \
  | npm run --silent select-tickets -- --max 3
# -> e.g. [42,7,13]
```

## Claiming (idempotency)

Selection is read-only: the `select` job only chooses the ticket numbers and never changes a label.
Each ticket is then claimed inside its own per-ticket job, as that job's first step: it adds `claude:in-progress` and removes `agent:ready` before any work starts.
That is the claim lock: a later run will not re-pull a ticket that is already in progress.
Keeping the claim per-ticket makes each ticket's lifecycle self-contained - one ticket failing to claim or run can never strand another.

The same per-ticket job ends with a park step that always runs.
If the job finishes without an open PR for `fm/issue-<number>` - a failed run, a risky finding the agent stopped on, or no change needed - the ticket is moved to `claude:needs-captain` and a comment is left, so it parks for you instead of being stranded in `claude:in-progress`.
The park step is deliberately resilient: it only skips parking on a *confirmed* open PR, and parks on any uncertainty (the PR check errored or returned nothing).
When a PR is open, the claim stays in place and the PR waits for you.
Each per-ticket job also carries a 30-minute `timeout-minutes`, so a hung agent run is cut off rather than holding a runner indefinitely; because the park step runs with `if: always()`, it still fires on a timeout and the ticket is parked instead of stranded in `claude:in-progress`.

## One-time setup

1. **Labels.** Run `scripts/agent-loop/setup-labels.sh` (optionally `--repo owner/name`) to create the labels idempotently.
2. **Claude Code OAuth token.** Install the Claude GitHub app and run the [Claude Code GitHub installer](https://code.claude.com/docs/en/github-actions) (`/install-github-app` from the Claude Code CLI), which adds the `claude.yml` / `claude-code-review.yml` workflows and stores a `CLAUDE_CODE_OAUTH_TOKEN` repository secret (Settings -> Secrets and variables -> Actions).
   `agent-dispatch.yml` authenticates `anthropics/claude-code-action@v1` with that same token (your Claude subscription) rather than a metered API key, and passes the workflow's default `GITHUB_TOKEN` as `github_token`.
   The action's GitHub work runs under that default token, so each job that runs the action grants it `contents`/`issues`/`pull-requests: write` plus `actions: read`.

That is the whole setup. The workflows install the `no-mistakes` CLI on the runner automatically, via

```sh
curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh
```

which auto-detects the runner's platform build and puts `no-mistakes` on `PATH` - so there is no installer variable to configure.

## Board sync (optional)

The agent loop drives issue **labels** (`claude:in-progress`, `claude:needs-captain`).
On a GitHub Projects v2 board, the *column* a card sits in is driven by the project's single-select **Status** field, not by labels - so without an extra step the card would not move as the agent works.
Board sync is the optional step that keeps the card's Status in step with the lifecycle.

It is entirely best-effort: if it is not configured, the loop runs exactly as before and nothing fails.

To enable it:

1. **Secret.** Add a `PROJECTS_TOKEN` repository secret: a fine-grained personal access token with **Projects** read+write permission (the default `GITHUB_TOKEN` cannot write user/org Projects v2, which is why a separate PAT is needed - this uses a PAT, not OIDC).
2. **Status options.** On the project, the **Status** field must offer options named `In Progress`, `In Review`, and `Needs captain` (matched case-insensitively).
   `Done` is **not** required here: the merge -> `Done` transition is handled natively by GitHub Projects' built-in "pull request merged / item closed -> Done" workflow, and tickets close via `Closes #<n>` in the PR body.

Once set up, the workflows move the card automatically:

- **Claimed** -> `In Progress` (dispatch, right after `claude:in-progress` is added).
- **PR opened** -> `In Review` (dispatch, when an open PR exists for the branch).
- **Parked** -> `Needs captain` (dispatch, alongside the `claude:needs-captain` label when no PR was opened).

`@claude` follow-ups on an existing PR (via the installer's `claude.yml`) do not move the card; the PR is already in `In Review` and stays there until you merge it.

The mechanics live in the pure `setProjectStatus(...)` helper (`scripts/agent-loop/setProjectStatus.ts`, covered by `setProjectStatus.test.ts`), called by the thin CLI `setProjectStatus.cli.ts` (also `npm run set-project-status`).
Both the CLI and the helper are non-fatal by design - a missing `PROJECTS_TOKEN`, an issue on no project, a missing `Status` field or option, or any API error logs a clear message and exits `0`.
The workflow steps additionally carry `continue-on-error: true`, so board sync can never block or fail the loop.

## Rollout

The loop is built so you can prove it before trusting the schedule:

1. Run `scripts/agent-loop/setup-labels.sh` and make sure the `CLAUDE_CODE_OAUTH_TOKEN` secret is in place (added by the Claude Code GitHub installer).
2. Create one disposable ticket, label it `agent:ready` + `priority:low`, and trigger `agent-dispatch` manually (Actions -> Agent issue dispatch -> Run workflow).
3. Confirm it implements, runs no-mistakes, and opens a PR. Then `@claude`-mention that PR with a change request and confirm `claude.yml` wakes and updates it.
4. Once the dry-run is clean, the twice-daily schedule is already wired; the loop runs on its own from there.

## Safety

- Nothing merges automatically - the captain merges every PR.
- PR follow-ups only fire on an explicit `@claude` mention (the installer's `claude.yml`), so the agent acts when you ask it to rather than on every comment.
- Event data (the dispatch `max` input, PR numbers) is never interpolated into a shell `run:` line; it is passed through `env:` and referenced as a quoted variable, which avoids GitHub Actions script injection.
- no-mistakes runs in full; routine findings are auto-approved, and genuinely risky or irreversible ones stop the run cleanly. Any run that ends without an open PR - a clean risky stop or an outright failure - parks the ticket to `claude:needs-captain` rather than leaving it stuck in `claude:in-progress`.
