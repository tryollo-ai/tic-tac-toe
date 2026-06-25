# Agent issue loop

An opt-in, scheduled loop that turns Kanban tickets into reviewable pull requests.

## What it does

You open tickets on the repository's GitHub issues / Project board and mark the ones you want worked.
Twice a day a workflow picks up to three of those tickets by priority, claims them, and runs one agent per ticket.
Each agent implements its ticket, validates with no-mistakes, and opens a pull request.
When you ask for changes on one of those PRs, a second workflow wakes an agent to address the feedback.
Nothing is ever merged automatically; every PR waits for you.

Two workflows make this up:

- `.github/workflows/agent-dispatch.yml` - scheduled (00:00 and 12:00 UTC) and manual; selects, claims, and fans out work.
- `.github/workflows/agent-respond.yml` - event-driven; wakes an agent when you request changes on an agent PR.

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
The responder job (`agent-respond.yml`) has the same 30-minute bound.

## One-time setup

1. **Labels.** Run `scripts/agent-loop/setup-labels.sh` (optionally `--repo owner/name`) to create the labels idempotently.
2. **API key.** Add an `ANTHROPIC_API_KEY` repository secret (Settings -> Secrets and variables -> Actions).
   The workflows authenticate `anthropics/claude-code-action@v1` with this static key and pass the workflow's default `GITHUB_TOKEN` as `github_token`, so the Claude GitHub App is not required and the action never fetches an OIDC token.
   The action's GitHub work runs under that default token, so each job that runs the action grants it `contents`/`issues`/`pull-requests: write` plus `actions: read` (no `id-token: write`).

That is the whole setup. The workflows install the `no-mistakes` CLI on the runner automatically, via

```sh
curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh
```

which auto-detects the runner's platform build and puts `no-mistakes` on `PATH` - so there is no installer variable to configure.

## Rollout

The loop is built so you can prove it before trusting the schedule:

1. Run `scripts/agent-loop/setup-labels.sh` and add the `ANTHROPIC_API_KEY` secret.
2. Create one disposable ticket, label it `agent:ready` + `priority:low`, and trigger `agent-dispatch` manually (Actions -> Agent issue dispatch -> Run workflow).
3. Confirm it implements, runs no-mistakes, and opens a PR. Then request changes on that PR and confirm `agent-respond` wakes and updates it.
4. Once the dry-run is clean, the twice-daily schedule is already wired; the loop runs on its own from there.

## Safety

- Nothing merges automatically - the captain merges every PR.
- The responder only reacts to the repository owner, so it never loops on its own bot comments or pushes.
- Event data (the dispatch `max` input, PR numbers) is never interpolated into a shell `run:` line; it is passed through `env:` and referenced as a quoted variable, which avoids GitHub Actions script injection.
- no-mistakes runs in full; routine findings are auto-approved, and genuinely risky or irreversible ones stop the run cleanly. Any run that ends without an open PR - a clean risky stop or an outright failure - parks the ticket to `claude:needs-captain` rather than leaving it stuck in `claude:in-progress`.
