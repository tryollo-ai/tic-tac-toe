#!/usr/bin/env bash
# Create (or update) the labels the agent issue loop relies on, idempotently.
# Safe to re-run: existing labels are updated in place, missing ones are created.
#
# Labels:
#   agent:ready           opt-in trigger; the ONLY thing that makes a ticket eligible
#   priority:critical     ordering: worked first
#   priority:high
#   priority:med
#   priority:low          ordering: worked last among eligible tickets
#   claude:in-progress    claim lock written when a run starts a ticket
#   claude:needs-captain  parked for the captain (a risky finding, or a failed run)
#   type:tracking         optional marker for non-deliverable / tracking tickets
#
# Uses gh-axi when available, else gh. Requires GitHub auth.
# Usage: scripts/agent-loop/setup-labels.sh [--repo <owner/name>]
set -eu

REPO=""
usage() { echo "usage: setup-labels.sh [--repo <owner/name>]" >&2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "setup-labels: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

GH=gh
command -v gh-axi >/dev/null 2>&1 && GH=gh-axi
if ! command -v "$GH" >/dev/null 2>&1; then
  echo "setup-labels: need gh-axi or gh on PATH" >&2
  exit 3
fi

ensure_label() {
  name="$1"; color="$2"; desc="$3"
  set -- label create "$name" --color "$color" --description "$desc"
  [ -n "$REPO" ] && set -- "$@" --repo "$REPO"
  if "$GH" "$@" >/dev/null 2>&1; then
    echo "created: $name"
    return
  fi
  set -- label edit "$name" --color "$color" --description "$desc"
  [ -n "$REPO" ] && set -- "$@" --repo "$REPO"
  if "$GH" "$@" >/dev/null 2>&1; then
    echo "updated: $name"
  else
    echo "skip:    $name (could not create or update)" >&2
  fi
}

ensure_label "agent:ready"          "0e8a16" "Opt-in: let the agent loop work this ticket"
ensure_label "priority:critical"    "b60205" "Agent loop: worked first"
ensure_label "priority:high"        "d93f0b" "Agent loop: high priority"
ensure_label "priority:med"         "fbca04" "Agent loop: medium priority"
ensure_label "priority:low"         "0e8a16" "Agent loop: low priority"
ensure_label "claude:in-progress"   "1d76db" "Agent loop: claimed and in flight"
ensure_label "claude:needs-captain" "5319e7" "Agent loop: parked for the captain's decision"
ensure_label "type:tracking"        "c5def5" "Tracking / non-deliverable; not for the agent"
