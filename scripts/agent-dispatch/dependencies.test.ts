import { describe, expect, it } from "vitest";
import {
  parseBlockerRefs,
  resolveBlockedBy,
  UNRESOLVED_BLOCKER,
} from "./dependencies";

describe("parseBlockerRefs", () => {
  it("returns no refs for an empty or absent body", () => {
    expect(parseBlockerRefs(undefined)).toEqual([]);
    expect(parseBlockerRefs("")).toEqual([]);
    expect(parseBlockerRefs("Just a normal ticket with no relations.")).toEqual(
      [],
    );
  });

  it("parses a single 'Blocked by #N' relation", () => {
    expect(parseBlockerRefs("Blocked by #12")).toEqual([12]);
  });

  it("parses 'Depends on #N' as a blocker too", () => {
    expect(parseBlockerRefs("Depends on #7")).toEqual([7]);
  });

  it("is case-insensitive", () => {
    expect(parseBlockerRefs("BLOCKED BY #3")).toEqual([3]);
    expect(parseBlockerRefs("depends ON #4")).toEqual([4]);
  });

  it("parses a comma/and/ampersand-joined list", () => {
    expect(parseBlockerRefs("Depends on #3, #4 and #5 & #6")).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it("tolerates an optional colon after the keyword", () => {
    expect(parseBlockerRefs("Blocked by: #9")).toEqual([9]);
  });

  it("accepts the hyphenated 'blocked-by' / 'depends-on' spellings", () => {
    expect(parseBlockerRefs("blocked-by #1")).toEqual([1]);
    expect(parseBlockerRefs("depends-on #2")).toEqual([2]);
  });

  it("collects refs across multiple relation lines, de-duplicated in order", () => {
    const body = [
      "Some context here.",
      "Blocked by #10",
      "More notes.",
      "Depends on #11, #10",
    ].join("\n");
    expect(parseBlockerRefs(body)).toEqual([10, 11]);
  });

  it("does not pull in stray refs from trailing prose on the same line", () => {
    // Only the contiguous run right after the keyword counts; #99 is prose.
    expect(parseBlockerRefs("Blocked by #1 before tackling #99")).toEqual([1]);
  });

  it("ignores plain issue mentions that are not blocker relations", () => {
    expect(parseBlockerRefs("Related to #5, see also #6")).toEqual([]);
  });
});

describe("resolveBlockedBy", () => {
  const noBody = new Map<number, string>();

  it("returns no blockers when native and body are both empty", () => {
    expect(resolveBlockedBy({ blockers: [], total: 0 }, [], noBody)).toEqual([]);
  });

  it("uses native blockers (the primary source) with their states", () => {
    // This is the #34 -> #41 case: a native 'Blocked by' set in the UI, with
    // nothing in the body.
    const native = { blockers: [{ number: 41, state: "OPEN" }], total: 1 };
    expect(resolveBlockedBy(native, [], noBody)).toEqual([
      { number: 41, state: "OPEN" },
    ]);
  });

  it("merges native and body refs, de-duping by number (native state wins)", () => {
    const native = { blockers: [{ number: 41, state: "OPEN" }], total: 1 };
    const bodyStates = new Map([
      [41, "CLOSED"],
      [12, "OPEN"],
    ]);
    expect(resolveBlockedBy(native, [41, 12], bodyStates)).toEqual([
      { number: 41, state: "OPEN" }, // native wins over the body's CLOSED
      { number: 12, state: "OPEN" }, // body-only ref keeps its resolved state
    ]);
  });

  it("resolves a body ref with no known state to UNKNOWN", () => {
    expect(resolveBlockedBy({ blockers: [], total: 0 }, [12], noBody)).toEqual([
      { number: 12, state: "UNKNOWN" },
    ]);
  });

  it("fails closed with one UNKNOWN blocker when the native read errored", () => {
    expect(resolveBlockedBy("error", [], noBody)).toEqual([
      { number: UNRESOLVED_BLOCKER, state: "UNKNOWN" },
    ]);
  });

  it("pads with UNKNOWN when GitHub counts more blockers than it returned", () => {
    // totalBlockedBy is 2 but only one node came back (cross-repo / paged out):
    // the shortfall becomes an UNKNOWN blocker so the ticket stays blocked.
    const native = { blockers: [{ number: 41, state: "CLOSED" }], total: 2 };
    expect(resolveBlockedBy(native, [], noBody)).toEqual([
      { number: 41, state: "CLOSED" },
      { number: UNRESOLVED_BLOCKER, state: "UNKNOWN" },
    ]);
  });
});
