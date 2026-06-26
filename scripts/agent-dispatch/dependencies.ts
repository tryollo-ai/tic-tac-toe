// Pure dependency helpers for the ticket selector.
//
// A ticket's blockers come from two sources, both honored:
//   1. GitHub's NATIVE issue dependencies - the "Blocked by" relationships set in
//      the issue UI (GraphQL `Issue.blockedBy`). This is the primary source.
//   2. A free-text convention in the issue body, e.g.
//        Blocked by #12
//        Depends on #3, #4 and #5
//      a convenience for people who write the relation in prose.
// A blocker is satisfied once the referenced issue is closed; until then the
// dependent ticket must not be auto-picked (see selectTickets' eligibility rule).
//
// Parsing the body and merging the two sources live here as pure, offline-testable
// functions. The network reads - the native `blockedBy` connection and the state
// of body-only refs - are done by enrichDependencies.cli, which feeds the merged
// result back onto each issue as `blockedBy`.

import type { BlockerRef } from "./selectTickets";

/**
 * Matches a blocker keyword ("blocked by" / "depends on", hyphen or space, an
 * optional colon) immediately followed by a contiguous run of `#N` issue
 * references joined by commas, "and", or "&". Capturing only that run - not the
 * rest of the line - means trailing prose ("Blocked by #1 before the redesign")
 * does not pull in stray references, while a clean list ("Depends on #3, #4")
 * captures every member.
 */
const BLOCKER_LIST =
  /(?:blocked[ -]by|depends[ -]on)\s*:?\s*((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi;

/** A single `#N` reference within a captured blocker list. */
const ISSUE_REF = /#(\d+)/g;

/**
 * Issue numbers this body declares itself blocked by, in first-seen order with
 * duplicates removed. Returns an empty array for an empty/absent body or a body
 * with no blocker relations.
 */
export const parseBlockerRefs = (body: string | undefined): number[] => {
  if (!body) return [];

  const found: number[] = [];
  const seen = new Set<number>();
  for (const match of body.matchAll(BLOCKER_LIST)) {
    const segment = match[1] ?? "";
    for (const ref of segment.matchAll(ISSUE_REF)) {
      const number = Number(ref[1]);
      if (!seen.has(number)) {
        seen.add(number);
        found.push(number);
      }
    }
  }
  return found;
};

/**
 * An issue's native "Blocked by" dependencies as read from GitHub, or the marker
 * `"error"` when they could not be read at all. `total` is GitHub's own
 * `totalBlockedBy` count (it includes blockers the `blockers` list may not carry,
 * e.g. cross-repo or beyond the page size), used as a fail-closed backstop.
 */
export type NativeBlockers = { blockers: BlockerRef[]; total: number } | "error";

/**
 * The number stamped on a blocker we know exists but could not resolve to a real
 * issue (a read error, or a blocker GitHub counted but did not return). Its state
 * is UNKNOWN, so it keeps the dependent ticket blocked - fail closed.
 */
export const UNRESOLVED_BLOCKER = -1;

const unknown = (): BlockerRef => ({
  number: UNRESOLVED_BLOCKER,
  state: "UNKNOWN",
});

/**
 * Merge an issue's native dependencies with its body-declared refs into the single
 * `blockedBy` list the selector consumes. De-dupes by issue number (native state
 * wins). Fail closed:
 *   - if the native read errored, the issue carries one UNKNOWN blocker;
 *   - if GitHub counts more blockers than were resolved (cross-repo / paged out),
 *     the shortfall is padded with UNKNOWN blockers.
 * A body ref with no known state also resolves to UNKNOWN. An issue with no
 * blockers from either source returns an empty list (it is not blocked).
 */
export const resolveBlockedBy = (
  native: NativeBlockers,
  bodyRefs: number[],
  bodyStates: Map<number, string>,
): BlockerRef[] => {
  const byNumber = new Map<number, string>();
  let unknownPad = 0;

  if (native === "error") {
    unknownPad += 1;
  } else {
    for (const blocker of native.blockers) {
      byNumber.set(blocker.number, blocker.state);
    }
    const missing = native.total - byNumber.size;
    if (missing > 0) unknownPad += missing;
  }

  for (const ref of bodyRefs) {
    if (!byNumber.has(ref)) {
      byNumber.set(ref, (bodyStates.get(ref) ?? "UNKNOWN").toUpperCase());
    }
  }

  const merged: BlockerRef[] = [...byNumber.entries()].map(([number, state]) => ({
    number,
    state,
  }));
  for (let i = 0; i < unknownPad; i++) merged.push(unknown());
  return merged;
};
