# agent-kit

A droppable kit that wires a GitHub repo for two things:

- **Agent issue dispatch** - a scheduled (and on-demand) loop that picks up opt-in tickets, runs one Claude agent per ticket to implement them, validates each with [no-mistakes](https://github.com/kunchenguid/no-mistakes), and opens a pull request. Nothing merges automatically.
- **Claude review** - `@claude` follow-ups on issues/PRs and an automated review on every opened/updated PR.

Everything the loop needs lives in this directory. The only things that land in the host repo are the three workflow files (GitHub Actions requires them under `.github/workflows/`) and one `tsx` devDependency. The kit stays self-contained and re-droppable.

## Quick start

1. Drop this `agent-kit/` directory into the root of the target repo (you may rename it; the setup skill detects the real name).
2. In Claude Code, from the repo root, say: **"use the setup skill in agent-kit"** (or run `/agent-kit-setup`).
3. The skill ([`SKILL.md`](./SKILL.md)) idempotently provisions whatever is missing - it installs the workflow files, adapts them to your project, creates only the labels/secrets you don't already have, ensures `tsx`, and walks you through the manual GitHub App + Projects board steps it can't do over the CLI.

Re-running the skill is a no-op once everything is in place.

## What's in here

```
agent-kit/
├── SKILL.md            # the setup runbook Claude executes (idempotent)
├── README.md           # this file
├── docs/
│   └── operations.md   # how the loop behaves once installed (opt-in gates, selection, board sync, safety)
├── workflows/          # canonical sources; setup copies these into .github/workflows/
│   ├── agent-dispatch.yml      # the scheduled dispatch loop (references agent-kit/scripts/*)
│   ├── claude.yml              # @claude follow-ups
│   └── claude-code-review.yml  # automated PR review
├── scripts/            # the dispatch TypeScript (Node built-ins + tsx; vitest for *.test.ts)
│   ├── *.ts, *.cli.ts, *.test.ts
│   └── setup-labels.sh
└── config/
    ├── actionlint.yaml   # create-github-app-token@v3 suppression (merged into .github/actionlint.yaml)
    └── no-mistakes.yaml  # evidence-store config (placed as .no-mistakes.yaml)
```

## What the loop needs (the setup skill provisions all of it)

- **Labels:** `agent:ready`, `agent:in-progress`, `agent:done`, `agent:needs-help`, and `priority:critical|high|med|low`.
- **Secrets:** `CLAUDE_CODE_OAUTH_TOKEN` (your Claude subscription), plus `PROJECTS_APP_ID` and `PROJECTS_APP_PRIVATE_KEY` for the GitHub App that reads/writes the Projects v2 board.
- **A GitHub App** with Projects (organization) read+write, installed on the repo, whose client-id/private-key back the two secrets above.
- **A Projects v2 board** whose Status field offers `Ready`, `In Progress`, and `In Review` options.
- **`tsx`** as a devDependency (the workflows run the scripts via `npx tsx`).

See [`docs/operations.md`](./docs/operations.md) for the full behavior: the label+Ready-column opt-in gates, the dependency gate, agent-driven selection, claiming, board sync, and safety properties.

## Updating / removing

Because the kit is self-contained, updating it is "replace this directory and re-run the skill"; removing it is "delete `.github/workflows/{agent-dispatch,claude,claude-code-review}.yml`, the `tsx` devDependency if unused, and this directory."
