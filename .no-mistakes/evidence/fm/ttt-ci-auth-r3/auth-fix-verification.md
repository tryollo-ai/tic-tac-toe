# Agent-loop CI auth fix - verification

Branch: `fm/ttt-ci-auth-r3` · target commit `1a2e90b`

## The bug (reproduced on real CI, pre-fix)

A `workflow_dispatch` of **Agent issue dispatch** on `main` (the pre-fix workflow)
ran 2026-06-25 and failed at the `anthropics/claude-code-action@v1` step. The action
received an empty `github_token`, fell back to fetching a GitHub OIDC token, and died:

```
"github_token": "",
Requesting OIDC token...
error: Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable
Attempt 1/2/3 failed: Could not fetch an OIDC token.
  Did you remember to add `id-token: write` to your workflow permissions?
##[error]Action failed with error: Could not fetch an OIDC token...
```

Run: https://github.com/puopg/tic-tac-toe/actions/runs/28192896440 (job "Agent: issue #26", step 8).
Full excerpt: `baseline-failure-oidc.log`.

This is exactly the failure the change targets: no Claude GitHub App is installed and no
`id-token: write` permission is granted, so the OIDC path can never succeed.

## The fix (verified in the worktree at target commit)

The correct fix for a static-`ANTHROPIC_API_KEY`, no-App repo is to hand the action the
default `GITHUB_TOKEN` so it never attempts OIDC, and to grant `actions: read` to the jobs
that run it - **without** adding `id-token: write` (which would only move the failure to the
next step, since no App is installed).

| Requirement | agent-dispatch.yml | agent-respond.yml |
|---|---|---|
| `github_token: ${{ github.token }}` on the action's `with:` | line 137 ✓ | line 99 ✓ |
| `actions: read` added to the job running the action | line 91 ✓ (job `work` perms) | line 26 ✓ (workflow perms) |
| existing `contents`/`issues`/`pull-requests: write` preserved | ✓ | ✓ |
| `id-token: write` NOT added (none anywhere in `.github/`) | ✓ | ✓ |

`docs/agent-loop.md` (One-time setup §) now documents the default-`GITHUB_TOKEN`,
no-App, no-OIDC auth model and the `actions: read` (no `id-token: write`) grant.

Both workflow files parse as valid YAML. The diff is exactly these six lines and nothing else.

## Green-path note

The fixed workflow only runs from a branch via a live `workflow_dispatch`, which would
launch a real Claude agent on an `agent:ready` ticket, open a PR, and spend API credits.
Issue #26 (the only candidate) was already parked to `claude:needs-captain` by the failed
run, so it is no longer eligible. Producing a green run therefore requires an outward-facing,
credit-spending live agent dispatch, which was not triggered as part of validation.
