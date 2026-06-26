// Parse "blocked by" / "depends on" relations out of an issue body.
//
// Relations are a free-text convention in the issue body, e.g.
//   Blocked by #12
//   Depends on #3, #4 and #5
// A blocker is satisfied once the referenced issue is closed; until then the
// dependent issue must not be auto-picked (see selectTickets' eligibility rule).
//
// Parsing lives here as a pure, offline-testable function. Resolving each
// blocker's open/closed state - the only part that touches the network - is done
// by enrichDependencies.cli, which feeds the resolved states back onto the issue
// as `blockedBy`.

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
