// Select which tickets the scheduled agent loop should work this run.
//
// This is the single source of truth for ticket eligibility and ordering. It is
// a pure function over the JSON shape produced by
//   gh issue list --json number,title,labels,createdAt,state
// so it can be unit-tested without the network (see selectTickets.test.ts) and
// driven from the workflow through the thin CLI wrapper (selectTickets.cli.ts).
//
// Selection is strictly opt-in and idempotent:
//   - the issue must be OPEN,
//   - it must carry READY_LABEL (agent:ready),
//   - it must NOT already be claimed, done, or held (agent:in-progress /
//     agent:done / agent:needs-help), so a later run never re-pulls work that
//     is in flight or already finished,
//   - it must NOT be blocked by a still-open issue (its `blockedBy` relations,
//     resolved upstream by enrichDependencies.cli, must all be CLOSED),
//   - and, when `requireReadyStatus` is set, it must ALSO sit in the board's
//     "Ready" column (its Projects v2 Status equals READY_STATUS). This is the
//     second, independent gate: the label marks a ticket as automatable, the
//     Ready column says "work it now". Together they let a team keep an ordinary
//     board with no column->label automation - a labelled ticket parked in
//     Backlog is invisible until it is dragged into Ready.
// Eligible issues are ordered by priority (critical > high > med > low, then
// unprioritised), and within a priority tier oldest-first (FIFO) so nothing
// starves. At most `max` tickets (default 3) are returned.
//
// The status comes in on each issue's `status` field, injected upstream by the
// enrich step (see enrichIssueStatus.cli.ts); this module stays pure and offline.
// An unknown/missing status is treated as "not Ready" - fail closed, so a ticket
// whose board column could not be read is never auto-picked.

/** One label, as returned in `gh issue list --json labels`. */
export type IssueLabel = {
  name: string;
};

/**
 * A blocker relation resolved to the referenced issue's open/closed state, as
 * produced by the dependency enrich step (enrichDependencies.cli). `state` is the
 * blocker issue's GraphQL state, upper-cased: anything other than "CLOSED" (an
 * open blocker, or "UNKNOWN" when the state could not be read) keeps the
 * dependent issue blocked - fail closed.
 */
export type BlockerRef = {
  number: number;
  state: string;
};

/**
 * One issue - the subset of fields the loop reads from
 * `gh issue list --json number,title,labels,createdAt,state,body`. Every field
 * but `number` is optional so partial fixtures and real payloads both type-check.
 */
export type Issue = {
  number: number;
  title?: string;
  labels?: IssueLabel[];
  createdAt?: string;
  state?: string;
  /**
   * The issue's current Projects v2 board Status (e.g. "Ready", "Backlog"),
   * injected by the enrich step. Absent when status gating is off or the status
   * could not be read; with `requireReadyStatus` that absence means "not Ready".
   */
  status?: string;
  /** The issue body, used to parse "Blocked by #N" / "Depends on #N" relations. */
  body?: string;
  /**
   * Issues this one is blocked by, each resolved to its open/closed state by the
   * dependency enrich step. While any blocker is not yet CLOSED the issue is
   * ineligible; an absent/empty list means no known blockers.
   */
  blockedBy?: BlockerRef[];
};

export type SelectOptions = {
  max: number;
  /**
   * When true, a ticket must ALSO be in the board's "Ready" column
   * (`status` equals READY_STATUS, case-insensitive) on top of carrying the
   * agent:ready label. Unknown/missing status counts as not Ready (fail closed).
   * Defaults to false, preserving pure label-only selection.
   */
  requireReadyStatus?: boolean;
};

/** The opt-in trigger: the only label that makes a ticket eligible. */
export const READY_LABEL = "agent:ready";
/**
 * The board column (Projects v2 Status name) a ticket must be in when status
 * gating is on. Matched case-insensitively, so the project's option only needs
 * to match by spelling, not casing.
 */
export const READY_STATUS = "Ready";
/** Claim lock written when a run starts a ticket. */
export const IN_PROGRESS_LABEL = "agent:in-progress";
/** Done coding: set when the run opens a PR, which then waits for review. */
export const DONE_LABEL = "agent:done";
/** Parked for a maintainer (a risky finding, or a failed run). */
export const HOLD_LABEL = "agent:needs-help";

/** Priority labels, highest priority first; the index is the sort rank. */
export const PRIORITY_LABELS = [
  "priority:critical",
  "priority:high",
  "priority:med",
  "priority:low",
] as const;

const labelNames = (issue: Issue): Set<string> =>
  new Set((issue.labels ?? []).map((label) => label.name));

/** Lower is higher priority; unprioritised tickets sort after every tier. */
const priorityRank = (names: Set<string>): number => {
  const index = PRIORITY_LABELS.findIndex((label) => names.has(label));
  return index === -1 ? PRIORITY_LABELS.length : index;
};

const isReady = (issue: Issue): boolean =>
  (issue.status ?? "").trim().toLowerCase() === READY_STATUS.toLowerCase();

/**
 * True if any known blocker is not yet closed. An unreadable blocker comes in as
 * state "UNKNOWN" and still counts as blocking, so a dependent ticket whose
 * blockers could not be resolved is never auto-picked (fail closed).
 */
const hasOpenBlocker = (issue: Issue): boolean =>
  (issue.blockedBy ?? []).some(
    (blocker) => (blocker.state ?? "").trim().toUpperCase() !== "CLOSED",
  );

const isEligible = (issue: Issue, requireReadyStatus: boolean): boolean => {
  const names = labelNames(issue);
  const isOpen = (issue.state ?? "OPEN").toUpperCase() === "OPEN";
  return (
    isOpen &&
    names.has(READY_LABEL) &&
    !names.has(IN_PROGRESS_LABEL) &&
    !names.has(DONE_LABEL) &&
    !names.has(HOLD_LABEL) &&
    !hasOpenBlocker(issue) &&
    (!requireReadyStatus || isReady(issue))
  );
};

/**
 * The eligible issues for this run, in input order. Shared by the deterministic
 * selector below and the agent-driven selector's guardrail (selectTicketsAgent),
 * so both honor the exact same opt-in, claim, board-status, and dependency rules.
 */
export const filterEligible = (
  issues: Issue[],
  requireReadyStatus: boolean,
): Issue[] => issues.filter((issue) => isEligible(issue, requireReadyStatus));

/**
 * Pick the issue numbers to work this run, in the order they should be worked.
 * Pure and deterministic: same input always yields the same output. An empty or
 * fully-ineligible input yields an empty array, so the caller can cheaply no-op.
 */
export const selectTickets = (
  issues: Issue[],
  options: SelectOptions,
): number[] => {
  const { max, requireReadyStatus = false } = options;
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`max must be a non-negative integer, got: ${String(max)}`);
  }

  return filterEligible(issues, requireReadyStatus)
    .map((issue) => ({
      number: issue.number,
      rank: priorityRank(labelNames(issue)),
      createdAt: issue.createdAt ?? "",
    }))
    // ISO-8601 timestamps compare correctly as plain strings, so within a
    // priority tier the oldest ticket sorts first (FIFO).
    .sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt))
    .slice(0, max)
    .map((entry) => entry.number);
};
