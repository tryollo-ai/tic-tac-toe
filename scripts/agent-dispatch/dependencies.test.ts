import { describe, expect, it } from "vitest";
import { parseBlockerRefs } from "./dependencies";

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
