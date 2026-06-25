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
//   - it must NOT already be claimed or held (claude:in-progress /
//     claude:needs-captain), so a later run never re-pulls in-flight work.
// Eligible issues are ordered by priority (critical > high > med > low, then
// unprioritised), and within a priority tier oldest-first (FIFO) so nothing
// starves. At most `max` tickets (default 3) are returned.

/** One label, as returned in `gh issue list --json labels`. */
export type IssueLabel = {
  name: string;
};

/**
 * One issue - the subset of fields the loop reads from
 * `gh issue list --json number,title,labels,createdAt,state`. Every field but
 * `number` is optional so partial fixtures and real payloads both type-check.
 */
export type Issue = {
  number: number;
  title?: string;
  labels?: IssueLabel[];
  createdAt?: string;
  state?: string;
};

export type SelectOptions = {
  max: number;
};

/** The opt-in trigger: the only label that makes a ticket eligible. */
export const READY_LABEL = "agent:ready";
/** Claim lock written when a run starts a ticket. */
export const IN_PROGRESS_LABEL = "claude:in-progress";
/** Parked for the captain (a risky finding, or a failed run). */
export const HOLD_LABEL = "claude:needs-captain";

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

const isEligible = (issue: Issue): boolean => {
  const names = labelNames(issue);
  const isOpen = (issue.state ?? "OPEN").toUpperCase() === "OPEN";
  return (
    isOpen &&
    names.has(READY_LABEL) &&
    !names.has(IN_PROGRESS_LABEL) &&
    !names.has(HOLD_LABEL)
  );
};

/**
 * Pick the issue numbers to work this run, in the order they should be worked.
 * Pure and deterministic: same input always yields the same output. An empty or
 * fully-ineligible input yields an empty array, so the caller can cheaply no-op.
 */
export const selectTickets = (
  issues: Issue[],
  options: SelectOptions,
): number[] => {
  const { max } = options;
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`max must be a non-negative integer, got: ${String(max)}`);
  }

  return issues
    .filter(isEligible)
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
