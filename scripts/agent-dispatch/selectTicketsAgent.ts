// Agent-driven ticket selection with a deterministic guardrail.
//
// Instead of slicing the priority-sorted list, we hand the whole eligible,
// dependency-annotated candidate set to an agent and let it choose the subset to
// work this run - weighing priority, how many other tickets each one unblocks,
// and the per-run cap. The agent only *proposes*: chooseTickets filters its answer
// back down to real, eligible, not-blocked candidate numbers, dedupes, preserves
// the agent's order, and caps at `max`. If the agent is unavailable or returns
// nothing usable, it falls back to the deterministic selectTickets so the loop
// always makes forward progress.
//
// All the policy and parsing here is pure and unit-testable: the actual `claude`
// invocation is injected as `runAgent`, so tests drive it with a fake (see
// selectTicketsAgent.test.ts). The thin CLI (selectTicketsAgent.cli) wires in the
// real agent.

import {
  filterEligible,
  PRIORITY_LABELS,
  selectTickets,
  type Issue,
} from "./selectTickets";

/** The priority label on an issue, or "priority:none" when unprioritised. */
const priorityOf = (issue: Issue): string => {
  const names = new Set((issue.labels ?? []).map((label) => label.name));
  return PRIORITY_LABELS.find((label) => names.has(label)) ?? "priority:none";
};

/**
 * For each issue number, how many still-open issues are waiting on it. Lets the
 * agent prefer tickets that unblock the most downstream work. Counts a blocker
 * whose state is anything other than CLOSED (an open or unknown blocker), and
 * only from issues that are themselves still open.
 */
const computeUnblocks = (issues: Issue[]): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const issue of issues) {
    const isOpen = (issue.state ?? "OPEN").toUpperCase() === "OPEN";
    if (!isOpen) continue;
    for (const blocker of issue.blockedBy ?? []) {
      if ((blocker.state ?? "").trim().toUpperCase() !== "CLOSED") {
        counts.set(blocker.number, (counts.get(blocker.number) ?? 0) + 1);
      }
    }
  }
  return counts;
};

/** A compact, agent-facing view of one candidate ticket. */
const describeCandidate = (
  issue: Issue,
  unblocks: Map<number, number>,
): Record<string, unknown> => ({
  number: issue.number,
  title: issue.title ?? "",
  priority: priorityOf(issue),
  createdAt: issue.createdAt ?? "",
  // How many other open tickets this one would unblock once it lands.
  unblocks: unblocks.get(issue.number) ?? 0,
  // Body excerpt for context; trimmed so a long ticket can't dominate the prompt.
  summary: (issue.body ?? "").trim().slice(0, 600),
});

/**
 * Build the selection prompt. Candidates are already eligible and not blocked, so
 * the agent's job is purely to choose and order the subset to work this run.
 */
export const buildPrompt = (
  candidates: Issue[],
  unblocks: Map<number, number>,
  max: number,
): string => {
  const payload = candidates.map((issue) => describeCandidate(issue, unblocks));
  return [
    "You are the dispatcher for an automated coding agent loop.",
    `Choose at most ${max} ticket(s) to work this run from the candidates below.`,
    "",
    "Each candidate is already eligible and unblocked. Decide the subset and the",
    "order to work them, weighing:",
    "  - priority: critical > high > med > low > none;",
    "  - unblocks: prefer tickets that free up more downstream work (higher is better);",
    "  - fairness: older tickets (earlier createdAt) should not starve;",
    "  - scope: pick fewer than the cap if the remaining candidates are not worth a run.",
    "",
    "Candidates (JSON):",
    JSON.stringify(payload, null, 2),
    "",
    `Respond with ONLY a JSON array of the chosen issue numbers, ordered by the`,
    `sequence they should be worked, e.g. [42, 17]. Pick only from the candidate`,
    `numbers above and never more than ${max}. No prose, no code fences.`,
  ].join("\n");
};

/**
 * Pull a JSON array of integers out of the agent's raw text. Tolerant of stray
 * prose or code fences around it: scans for bracketed arrays and returns the last
 * one that parses as all-integers. Returns null when there is no usable array (so
 * the caller can fall back).
 */
export const parseAgentNumbers = (raw: string | null): number[] | null => {
  if (raw === null) return null;
  const candidates = raw.match(/\[[^[\]]*\]/g);
  if (!candidates) return null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(candidates[i]);
      if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n))) {
        return parsed as number[];
      }
    } catch {
      // Not valid JSON; try the next bracketed candidate.
    }
  }
  return null;
};

/**
 * The deterministic guardrail: keep only proposed numbers that are real eligible
 * candidates, drop duplicates, preserve the agent's order, and cap at `max`.
 */
export const applyGuardrail = (
  proposed: number[],
  eligible: Issue[],
  max: number,
): number[] => {
  const allowed = new Set(eligible.map((issue) => issue.number));
  const chosen: number[] = [];
  const seen = new Set<number>();
  for (const number of proposed) {
    if (!allowed.has(number) || seen.has(number)) continue;
    seen.add(number);
    chosen.push(number);
    if (chosen.length >= max) break;
  }
  return chosen;
};

export type ChooseTicketsParams = {
  issues: Issue[];
  max: number;
  requireReadyStatus?: boolean;
  /**
   * Runs the agent on the prompt and returns its raw text, or null on any failure
   * (binary missing, non-zero exit, timeout). Injected so the policy here stays
   * pure and testable.
   */
  runAgent: (prompt: string) => string | null;
};

/**
 * Choose the issue numbers to work this run. Lets the agent pick the subset, but
 * never trusts it blindly: the result is always a subset of the deterministically
 * eligible candidates, capped at `max`. Falls back to the deterministic selector
 * when the agent adds no value (everything fits) or returns nothing usable.
 */
export const chooseTickets = (params: ChooseTicketsParams): number[] => {
  const { issues, max, requireReadyStatus = false, runAgent } = params;
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`max must be a non-negative integer, got: ${String(max)}`);
  }

  const fallback = (): number[] =>
    selectTickets(issues, { max, requireReadyStatus });

  if (max === 0) return [];

  const eligible = filterEligible(issues, requireReadyStatus);
  if (eligible.length === 0) return [];
  // Nothing to choose: every eligible ticket fits, so there is no subset to pick.
  // Use the deterministic order (priority then FIFO) and skip the agent entirely.
  if (eligible.length <= max) return fallback();

  const prompt = buildPrompt(eligible, computeUnblocks(issues), max);
  const proposed = parseAgentNumbers(runAgent(prompt));
  if (proposed === null) return fallback();

  const chosen = applyGuardrail(proposed, eligible, max);
  // An empty/garbage pick from a non-empty candidate set means the agent gave us
  // nothing usable - fall back rather than no-op the whole run.
  return chosen.length > 0 ? chosen : fallback();
};
