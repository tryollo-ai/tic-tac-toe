---
name: agent-kit-setup
description: Set up this repo's agent issue-dispatch + Claude review GitHub automation - create the labels, secrets, GitHub App, and Projects board it needs, and install the workflow files. Use when a developer drops the agent-kit directory into a project and asks to set it up, configure the agent loop, or wire up agent dispatch / claude review.
user-invocable: true
allowed-tools: [Read, Bash, Edit, Write, AskUserQuestion]
---

# agent-kit setup

This skill installs and wires the **agent-kit** - the scheduled agent issue-dispatch loop plus the
Claude review workflows - into the repository it has been dropped into.
Read [`README.md`](./README.md) for what the kit is and [`docs/operations.md`](./docs/operations.md) for how
the loop behaves once installed.

Run the steps **in order**. Every step is **idempotent**: check the current state first and only fill
what is missing. Re-running the whole skill on a fully-configured repo must be a no-op. Never recreate or
overwrite something that already exists and matches; report it as "already present" instead.

Use `AskUserQuestion` / prose only where a value genuinely must come from the developer (secret values,
ambiguous build commands, whether the app needs a database). Everything detectable, detect.

Throughout, let **`KIT`** be this kit directory's path relative to the repo root (it is usually `agent-kit`,
but the developer may have renamed it - resolve it in Step 1 and use the real name everywhere below,
including when rewriting workflow script paths).

---

## Step 1 - Preflight

1. Confirm GitHub CLI auth: run `gh auth status`. If it fails, tell the developer to run `gh auth login`
   (suggest they type `! gh auth login` so it runs in-session) and stop until it works.
2. Resolve the target repo: `gh repo view --json nameWithOwner,owner,defaultBranchRef`. Record
   `owner.login`, the `owner.type` (User vs Organization - matters for the Projects board), and the default branch.
3. Resolve `KIT`: find this skill's own directory relative to the repo root (the directory containing this
   `SKILL.md`). Confirm `KIT/workflows/`, `KIT/scripts/`, and `KIT/config/` exist. If the dir was renamed,
   `KIT` is that new name - every path rewrite below uses it.
4. Detect the package manager: `yarn.lock` -> yarn, `pnpm-lock.yaml` -> pnpm, `package-lock.json` -> npm,
   else default to npm. Record it as `PM`.

Report a one-line preflight summary (repo, owner type, kit dir, package manager) before continuing.

---

## Step 2 - Install workflow files

GitHub Actions only runs workflows under `.github/workflows/`, so the three YAMLs must be copied there.
They reference the scripts at `agent-kit/scripts/...`; if `KIT` is not `agent-kit`, rewrite that prefix.

For each of `agent-dispatch.yml`, `claude.yml`, `claude-code-review.yml`:

1. If `.github/workflows/<file>` already exists and is byte-identical to the (path-rewritten) `KIT/workflows/<file>`,
   skip it and report "already installed".
2. If it exists but differs, show the developer a diff and ask before overwriting (they may have local edits).
3. Otherwise copy it into `.github/workflows/`. When `KIT` differs from `agent-kit`, rewrite every
   `agent-kit/scripts/` occurrence to `KIT/scripts/` in the copied `agent-dispatch.yml` (the other two have no
   script paths). Use `sed -e "s#agent-kit/scripts/#${KIT}/scripts/#g"` on the copy, never on the canonical source.

Then merge the config:

- **actionlint:** ensure `.github/actionlint.yaml` contains the create-github-app-token@v3 suppression from
  `KIT/config/actionlint.yaml`. If `.github/actionlint.yaml` is absent, copy it. If present, merge the
  `paths:` entry for the installed `agent-dispatch.yml` (keyed by its real installed path,
  `.github/workflows/agent-dispatch.yml`) without clobbering the developer's existing rules.
- **no-mistakes:** if `.no-mistakes.yaml` is absent at the repo root, copy `KIT/config/no-mistakes.yaml` to it.
  If present, leave it (report "already present"); only offer to merge the `test.evidence` block if it's missing.

---

## Step 3 - Adapt the dispatch workflow to this project

The installed `.github/workflows/agent-dispatch.yml` carries clearly-marked, self-documenting defaults for a
Postgres-backed app (this is where the tic-tac-toe origin shows through). Adapt them to the target by reading
its `package.json`. The project-specific surface is fenced in the YAML with
`>>> PROJECT-SPECIFIC (database) BEGIN` / `<<< ... END` markers and lives in the agent `PROMPT`.

1. **Read the target `package.json`** `scripts` block.
2. **Start command + dev port:** set the `PROMPT`'s "Start the app (`yarn start`, served on
   `http://localhost:3000`)" line to the target's real start script and port. Infer the start command from
   `scripts.start`/`scripts.dev` and the port from the framework (Next.js dev -> 3000, Vite -> 5173, CRA -> 3000,
   etc.). If you can't infer the port confidently, ask.
3. **Stack-conventions line:** set "match the repo's existing TypeScript / ESLint / CSS Modules conventions" to
   the target's actual stack (look at devDependencies/config: TS vs JS, ESLint/Biome/Prettier, CSS Modules vs
   Tailwind vs styled-components, etc.).
4. **Database service - decide, then act:**
   - The app needs a DB service if it has a migrate script (e.g. `db:migrate`, `prisma migrate`, `drizzle-kit`,
     `knex migrate`) or an ORM dependency (`prisma`, `@prisma/client`, `drizzle-orm`, `typeorm`, `sequelize`,
     `mongoose`) **and** the app reads a `DATABASE_URL`-style env at runtime. If this is ambiguous, **ask the
     developer** whether running the app needs a database.
   - **If yes:** keep the three `PROJECT-SPECIFIC (database)` blocks (the `DATABASE_URL` job env, the `services:`
     container, the "Apply database migrations" step). Adjust the service `image` to the right engine
     (Postgres/MySQL/Mongo), the `DATABASE_URL` to match, and the migrate step's command to the target's real
     migrate script. Keep the DB language in the prompt (steps 3's "A Postgres database is already provisioned...").
   - **If no:** delete all three fenced `PROJECT-SPECIFIC (database)` blocks (env, `services:`, migrate step) and
     strip the DB sentences from the prompt's step 3 (the "A ... database is already provisioned for you and
     DATABASE_URL is set ... do NOT start your own database." text), leaving just "Start the app (<start cmd>,
     served on <url>), wait until it responds, then ...".
5. The fallback PR-draft step and everything outside the marked blocks is generic - leave it untouched.

Show the developer the resulting DB decision and the adapted start/port/stack lines.

---

## Step 4 - Ensure `tsx`

The workflows run the scripts via `npx tsx`. If `tsx` is not already a devDependency in the target
`package.json`, add it with the detected `PM`:

- yarn: `yarn add -D tsx`
- pnpm: `pnpm add -D tsx`
- npm: `npm i -D tsx`

If it's already present, report "already present" and do nothing.

---

## Step 5 - Labels

Run the kit's idempotent label script (it uses `gh label create --force`, so it creates only what's missing and
updates the rest):

```sh
KIT/scripts/setup-labels.sh
```

(Add `--repo <owner/name>` if `gh` doesn't default to the right repo.) Report which labels it created vs updated.

---

## Step 6 - Secrets

The loop needs three repo secrets. The optional Vercel deploy trio (`VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`) is **out of scope** for this kit - do not set them.

1. List what's already set: `gh secret list`.
2. For each of `CLAUDE_CODE_OAUTH_TOKEN`, `PROJECTS_APP_ID`, `PROJECTS_APP_PRIVATE_KEY` that is **missing**:
   - **`CLAUDE_CODE_OAUTH_TOKEN`:** prefer pointing the developer at the Claude GitHub installer - tell them to
     run `/install-github-app` from the Claude Code CLI, which installs the app and stores this secret for them.
     If they'd rather paste a token, run `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.
   - **`PROJECTS_APP_ID` / `PROJECTS_APP_PRIVATE_KEY`:** these come from the GitHub App registered in Step 7.
     If the App doesn't exist yet, do Step 7 first, then set them here. Set the private key from its file:
     `gh secret set PROJECTS_APP_PRIVATE_KEY < app-private-key.pem`.
   - Ask the developer for any value you must collect; never invent a secret value.
3. Report which secrets already existed (left untouched) and which you set.

---

## Step 7 - GitHub App + Projects board (guided, mostly manual)

These can't be fully done through `gh`. Give the developer exact, numbered instructions and verify what's
verifiable afterward.

**Register the GitHub App** (skip if `PROJECTS_APP_ID`/`PROJECTS_APP_PRIVATE_KEY` already resolve to a working App):

1. Go to **Settings -> Developer settings -> GitHub Apps -> New GitHub App** (for an org-owned repo, do this under
   the org: `https://github.com/organizations/<org>/settings/apps/new`; for a user repo, under your account).
2. Name it anything (e.g. "<repo> agent projects"). Set Homepage URL to the repo URL. Uncheck **Webhook -> Active**.
3. **Permissions:**
   - Organization permissions -> **Projects: Read and write** (this is what reads the Ready-column gate and writes board sync).
   - Repository permissions -> **Contents: Read and write**, **Issues: Read and write**, **Pull requests: Read and write**,
     and **Workflows: Read and write** (the last lets agent PRs touch `.github/workflows/*`).
4. Create the App. Note its **Client ID**. Generate a **private key** (downloads a `.pem`).
5. **Install** the App on this repository (App settings -> Install App -> choose the repo).
6. Store the credentials as secrets (Step 6): `PROJECTS_APP_ID` = the Client ID, `PROJECTS_APP_PRIVATE_KEY` = the `.pem` contents.

**Projects v2 board:**

1. Ensure the repo's issues are tracked on a Projects v2 board with a single-select **Status** field.
2. The Status field must offer these options (matched case-insensitively): **Ready**, **In Progress**, **In Review**.
   `Backlog`/other columns need nothing special; `Done` is handled by Projects' native "merged -> Done" workflow.
3. The kit reads/writes Status through the App token, so no further wiring is needed once the options exist.

**Verify:** re-run `gh secret list` and confirm `PROJECTS_APP_ID` and `PROJECTS_APP_PRIVATE_KEY` now exist.
(The App install and board options can't be confirmed via `gh`; ask the developer to confirm they did them.)

---

## Step 8 - Verify the install

1. **Unit tests** from the new path. The kit tests are pure and need no database:

   ```sh
   npx vitest run KIT/scripts
   ```

   If the host repo's `vitest.config.ts` defines a `globalSetup` that requires infra (e.g. a Docker Postgres,
   as this kit's origin repo does), that setup runs even for the pure kit tests and can fail spuriously. When
   that happens, run the kit tests in isolation with a throwaway config that has no `globalSetup`:

   ```sh
   printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { environment: "node", include: ["KIT/scripts/**/*.test.ts"] } });\n' > kit-vitest.tmp.config.ts
   npx vitest run --config kit-vitest.tmp.config.ts; rm -f kit-vitest.tmp.config.ts
   ```

   (substitute the real `KIT` path). Expect all kit tests to pass. If `vitest` isn't installed, install it or
   report that tests couldn't run - `npx tsx` on a `*.test.ts` is not a substitute.
2. **Lint the installed workflows** with the merged actionlint config:

   ```sh
   actionlint .github/workflows/agent-dispatch.yml .github/workflows/claude.yml .github/workflows/claude-code-review.yml
   ```

   (If `actionlint` isn't installed, say so and skip - don't fail setup over a missing linter.)
3. **Scripts run from the new path** - a quick offline smoke of the selection pipeline:

   ```sh
   gh issue list --state open --label agent:ready \
     --json number,title,labels,createdAt,state,body --limit 100 \
     | npx tsx KIT/scripts/enrichIssueStatus.cli.ts \
     | npx tsx KIT/scripts/selectTickets.cli.ts --max 3 --require-ready-status
   ```

   Confirm it emits a JSON array (e.g. `[]` when nothing is Ready - that's success, not an error).
4. **Print the dry-run rollout** (don't execute it): tell the developer to create one disposable ticket labelled
   `agent:ready` + `priority:low`, drag it into the board's **Ready** column, then Actions -> **"Trigger - issue
   agent"** -> **Run workflow**, and confirm it implements, runs no-mistakes, and opens a PR.

---

## Step 9 - Summary

Print a checklist of what existed vs what you created vs what's still on the developer:

- Workflow files installed / already present.
- actionlint + no-mistakes config merged / already present.
- DB decision (DB service kept-and-adapted, or stripped) and the adapted start/port/stack lines.
- `tsx` added / already present.
- Labels created / updated.
- Secrets set / already present / still missing.
- **Manual, on the developer:** GitHub App registration + install (if not done), Projects board Status options
  (`Ready`, `In Progress`, `In Review`), and the dry-run rollout trigger.

End by reminding them the loop is opt-in and never auto-merges: a ticket runs only when it's `agent:ready`,
in the Ready column, and unblocked; every PR waits for review.
