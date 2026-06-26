import { describe, expect, it, vi } from "vitest";
import {
  applyGuardrail,
  buildPrompt,
  chooseTickets,
  parseAgentNumbers,
} from "./selectTicketsAgent";
import type { Issue } from "./selectTickets";

const T0 = "2026-01-01T00:00:00Z";

/** A ready, prioritised, open candidate issue. */
const candidate = (
  number: number,
  priority: string,
  extra: Partial<Issue> = {},
): Issue => ({
  number,
  createdAt: T0,
  state: "OPEN",
  labels: [{ name: "agent:ready" }, { name: priority }],
  ...extra,
});

describe("parseAgentNumbers", () => {
  it("returns null for null input", () => {
    expect(parseAgentNumbers(null)).toBeNull();
  });

  it("parses a bare JSON array", () => {
    expect(parseAgentNumbers("[42, 17]")).toEqual([42, 17]);
  });

  it("extracts the array from surrounding prose and code fences", () => {
    const raw = "Sure, here is my pick:\n```json\n[3, 1]\n```\nThanks!";
    expect(parseAgentNumbers(raw)).toEqual([3, 1]);
  });

  it("returns the last all-integer array when several appear", () => {
    expect(parseAgentNumbers("first [1,2] then [5,6]")).toEqual([5, 6]);
  });

  it("rejects a non-integer array", () => {
    expect(parseAgentNumbers('["a", "b"]')).toBeNull();
    expect(parseAgentNumbers("[1.5, 2]")).toBeNull();
  });

  it("returns null when there is no array at all", () => {
    expect(parseAgentNumbers("I could not decide.")).toBeNull();
  });
});

describe("applyGuardrail", () => {
  const eligible = [candidate(1, "priority:high"), candidate(2, "priority:low")];

  it("keeps only real candidate numbers, preserving agent order", () => {
    expect(applyGuardrail([2, 1], eligible, 3)).toEqual([2, 1]);
  });

  it("drops numbers that are not eligible candidates (hallucinations)", () => {
    expect(applyGuardrail([99, 1], eligible, 3)).toEqual([1]);
  });

  it("de-duplicates", () => {
    expect(applyGuardrail([1, 1, 2], eligible, 3)).toEqual([1, 2]);
  });

  it("caps at max", () => {
    expect(applyGuardrail([1, 2], eligible, 1)).toEqual([1]);
  });
});

describe("buildPrompt", () => {
  it("includes the cap, every candidate number, and the unblocks signal", () => {
    const candidates = [candidate(7, "priority:high")];
    const prompt = buildPrompt(candidates, new Map([[7, 3]]), 2);
    expect(prompt).toContain("at most 2");
    expect(prompt).toContain('"number": 7');
    expect(prompt).toContain('"unblocks": 3');
  });
});

describe("chooseTickets", () => {
  const runAgentNever = vi.fn(() => {
    throw new Error("agent should not have been called");
  });

  it("returns an empty array when max is 0 without calling the agent", () => {
    const runAgent = vi.fn(() => "[1]");
    expect(
      chooseTickets({
        issues: [candidate(1, "priority:high")],
        max: 0,
        runAgent,
      }),
    ).toEqual([]);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("skips the agent and uses deterministic order when everything fits", () => {
    const issues = [
      candidate(1, "priority:low"),
      candidate(2, "priority:critical"),
    ];
    // Two candidates, cap of 3: nothing to choose, so the agent is not consulted
    // and the deterministic priority order (critical first) is used.
    expect(chooseTickets({ issues, max: 3, runAgent: runAgentNever })).toEqual([
      2, 1,
    ]);
  });

  it("uses the agent's pick when it must choose a subset", () => {
    const issues = [
      candidate(1, "priority:low"),
      candidate(2, "priority:low"),
      candidate(3, "priority:low"),
    ];
    const runAgent = vi.fn(() => "[3, 1]");
    expect(chooseTickets({ issues, max: 2, runAgent })).toEqual([3, 1]);
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it("guards the agent's pick down to eligible numbers and the cap", () => {
    const issues = [
      candidate(1, "priority:low"),
      candidate(2, "priority:low"),
      candidate(3, "priority:low"),
    ];
    // 99 is a hallucination; the list also exceeds max - guardrail trims both.
    const runAgent = vi.fn(() => "[99, 3, 2, 1]");
    expect(chooseTickets({ issues, max: 2, runAgent })).toEqual([3, 2]);
  });

  it("falls back to deterministic selection when the agent fails", () => {
    const issues = [
      candidate(1, "priority:low"),
      candidate(2, "priority:critical"),
      candidate(3, "priority:high"),
    ];
    const runAgent = vi.fn(() => null);
    // Deterministic order: critical(2) > high(3), capped at 2.
    expect(chooseTickets({ issues, max: 2, runAgent })).toEqual([2, 3]);
  });

  it("falls back when the agent returns nothing usable", () => {
    const issues = [
      candidate(1, "priority:low"),
      candidate(2, "priority:critical"),
      candidate(3, "priority:high"),
    ];
    const runAgent = vi.fn(() => "[99, 100]");
    expect(chooseTickets({ issues, max: 2, runAgent })).toEqual([2, 3]);
  });

  it("never selects a blocked candidate, even if the agent names it", () => {
    const issues = [
      candidate(1, "priority:critical", {
        blockedBy: [{ number: 9, state: "OPEN" }],
      }),
      candidate(2, "priority:low"),
      candidate(3, "priority:low"),
      candidate(4, "priority:low"),
    ];
    // Three candidates are eligible (#2,#3,#4) and the cap is 2, so the agent is
    // consulted. It names the blocked #1; the guardrail (via filterEligible)
    // drops it, keeping only the eligible #4.
    const runAgent = vi.fn(() => "[1, 4]");
    expect(chooseTickets({ issues, max: 2, runAgent })).toEqual([4]);
  });

  it("excludes blocked candidates from the count that triggers the agent", () => {
    const issues = [
      candidate(1, "priority:low", {
        blockedBy: [{ number: 9, state: "OPEN" }],
      }),
      candidate(2, "priority:critical"),
      candidate(3, "priority:high"),
    ];
    // Only #2 and #3 are eligible; with cap 3 everything fits, so no agent call.
    expect(chooseTickets({ issues, max: 3, runAgent: runAgentNever })).toEqual([
      2, 3,
    ]);
  });
});
