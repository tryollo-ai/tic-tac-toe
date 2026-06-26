import { describe, expect, it } from "vitest";
import { selectTickets, type Issue } from "./selectTickets";

/** Build an issue fixture from a number, timestamp, state, and label names. */
const issue = (
  number: number,
  createdAt: string,
  state: string,
  ...labels: string[]
): Issue => ({
  number,
  createdAt,
  state,
  labels: labels.map((name) => ({ name })),
});

const T0 = "2026-01-01T00:00:00Z";

describe("selectTickets", () => {
  it("excludes tickets without the agent:ready opt-in label", () => {
    const issues = [
      issue(1, T0, "OPEN", "priority:high"),
      issue(2, T0, "OPEN", "agent:ready", "priority:high"),
    ];
    expect(selectTickets(issues, { max: 3 })).toEqual([2]);
  });

  it("excludes claimed, done, and held tickets even when ready", () => {
    const issues = [
      issue(3, T0, "OPEN", "agent:ready", "priority:high", "agent:in-progress"),
      issue(4, T0, "OPEN", "agent:ready", "priority:high", "agent:needs-help"),
      issue(8, T0, "OPEN", "agent:ready", "priority:high", "agent:done"),
      issue(5, T0, "OPEN", "agent:ready", "priority:low"),
    ];
    expect(selectTickets(issues, { max: 3 })).toEqual([5]);
  });

  it("excludes closed tickets", () => {
    const issues = [
      issue(6, T0, "CLOSED", "agent:ready", "priority:critical"),
      issue(7, T0, "OPEN", "agent:ready", "priority:low"),
    ];
    expect(selectTickets(issues, { max: 3 })).toEqual([7]);
  });

  it("orders by priority: critical > high > med > low > none", () => {
    const issues = [
      issue(10, T0, "OPEN", "agent:ready", "priority:low"),
      issue(11, T0, "OPEN", "agent:ready"),
      issue(12, T0, "OPEN", "agent:ready", "priority:critical"),
      issue(13, T0, "OPEN", "agent:ready", "priority:med"),
      issue(14, T0, "OPEN", "agent:ready", "priority:high"),
    ];
    expect(selectTickets(issues, { max: 5 })).toEqual([12, 14, 13, 10, 11]);
  });

  it("breaks ties within a priority tier oldest-first (FIFO)", () => {
    const issues = [
      issue(20, "2026-03-01T00:00:00Z", "OPEN", "agent:ready", "priority:high"),
      issue(21, "2026-01-01T00:00:00Z", "OPEN", "agent:ready", "priority:high"),
      issue(22, "2026-02-01T00:00:00Z", "OPEN", "agent:ready", "priority:high"),
    ];
    expect(selectTickets(issues, { max: 5 })).toEqual([21, 22, 20]);
  });

  it("caps the selection at max (default 3)", () => {
    const issues = [
      issue(30, "2026-01-01T00:00:00Z", "OPEN", "agent:ready", "priority:critical"),
      issue(31, "2026-01-02T00:00:00Z", "OPEN", "agent:ready", "priority:critical"),
      issue(32, "2026-01-03T00:00:00Z", "OPEN", "agent:ready", "priority:critical"),
      issue(33, "2026-01-04T00:00:00Z", "OPEN", "agent:ready", "priority:critical"),
    ];
    expect(selectTickets(issues, { max: 3 })).toEqual([30, 31, 32]);
  });

  it("treats missing state as OPEN", () => {
    const ready: Issue = { number: 40, createdAt: T0, labels: [{ name: "agent:ready" }] };
    expect(selectTickets([ready], { max: 3 })).toEqual([40]);
  });

  it("returns an empty array for empty input", () => {
    expect(selectTickets([], { max: 3 })).toEqual([]);
  });

  it("returns an empty array when max is 0", () => {
    const issues = [issue(50, T0, "OPEN", "agent:ready", "priority:high")];
    expect(selectTickets(issues, { max: 0 })).toEqual([]);
  });

  it("rejects a negative or non-integer max", () => {
    expect(() => selectTickets([], { max: -1 })).toThrow();
    expect(() => selectTickets([], { max: 1.5 })).toThrow();
  });

  describe("requireReadyStatus gate", () => {
    /** A ready-labelled, prioritised open issue carrying a board status. */
    const withStatus = (number: number, status?: string): Issue => ({
      number,
      createdAt: T0,
      state: "OPEN",
      labels: [{ name: "agent:ready" }, { name: "priority:high" }],
      status,
    });

    it("ignores status when the gate is off (label-only, unchanged)", () => {
      const issues = [withStatus(1, "Backlog"), withStatus(2, "Ready")];
      expect(selectTickets(issues, { max: 3 })).toEqual([1, 2]);
    });

    it("keeps only Ready-column tickets when the gate is on", () => {
      const issues = [withStatus(1, "Backlog"), withStatus(2, "Ready")];
      expect(
        selectTickets(issues, { max: 3, requireReadyStatus: true }),
      ).toEqual([2]);
    });

    it("matches the Ready status case-insensitively", () => {
      const issues = [withStatus(1, "ready"), withStatus(2, "READY")];
      expect(
        selectTickets(issues, { max: 3, requireReadyStatus: true }),
      ).toEqual([1, 2]);
    });

    it("treats a missing or unknown status as not Ready (fail closed)", () => {
      const issues = [
        withStatus(1, undefined),
        withStatus(2, ""),
        withStatus(3, "In Progress"),
        withStatus(4, "Ready"),
      ];
      expect(
        selectTickets(issues, { max: 3, requireReadyStatus: true }),
      ).toEqual([4]);
    });

    it("still requires the agent:ready label even when in the Ready column", () => {
      const labelless: Issue = {
        number: 5,
        createdAt: T0,
        state: "OPEN",
        labels: [{ name: "priority:high" }],
        status: "Ready",
      };
      expect(
        selectTickets([labelless], { max: 3, requireReadyStatus: true }),
      ).toEqual([]);
    });
  });
});
