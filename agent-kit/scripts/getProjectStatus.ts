// Read an issue's current Status on the GitHub Projects v2 board(s) it belongs
// to. The agent loop's ticket selector gates on this: a ticket is worked only
// when its card sits in the "Ready" column (Status = "Ready") in addition to
// carrying the agent:ready label. That lets a team keep an ordinary board with
// no column->label automation - the label marks a ticket automatable, the Ready
// column says "work it now".
//
// Like setProjectStatus, this is the pure core: it takes an injected GraphQL
// executor so it can be unit-tested without the network (getProjectStatus.test.ts).
// The enrich CLI (enrichIssueStatus.cli.ts) supplies a real fetch-backed executor
// authenticated with PROJECTS_TOKEN.
//
// Unlike the write path, this read feeds a GATE rather than cosmetic board sync,
// so the caller must decide what an unknown status means. This function never
// throws: it returns `status: null` (with a `reason` for the logs) when the issue
// is on no board, has no Status value set, or the query fails. The selector
// treats that null as "not Ready" - fail closed, so a card whose column we cannot
// read is never auto-picked.

import type { GraphQLExecutor } from "./setProjectStatus";

export type GetProjectStatusParams = {
  owner: string;
  repo: string;
  issueNumber: number;
  graphql: GraphQLExecutor;
  /** Defaults to console.log; injectable so tests can assert on messages. */
  log?: (message: string) => void;
};

export type GetProjectStatusResult = {
  /** The issue's Status option name, or null if none could be resolved. */
  status: string | null;
  /** Set when status is null, explaining the no-op for the logs. */
  reason?: string;
};

type SingleSelectValue = { name?: string } | null;

type ProjectItem = {
  project: { id: string; title?: string };
  fieldValueByName: SingleSelectValue;
};

type IssueProjectStatusData = {
  repository: {
    issue: {
      projectItems: { nodes: ProjectItem[] };
    } | null;
  } | null;
};

// Read the Status single-select value of each of the issue's Projects v2 cards.
// A card with no Status set, or a "Status" field that is not single-select,
// matches no inline fragment and yields a `fieldValueByName` with no `name`,
// which we treat as "no status".
const ISSUE_PROJECT_STATUS_QUERY = `
  query IssueProjectStatus($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
            project {
              id
              title
            }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Resolve the issue's current board Status. Returns the first project card that
 * has a Status value set (the common single-board case has exactly one). Returns
 * `{ status: null, reason }` when the issue is on no board, no card has a Status,
 * or the query fails. Never throws.
 */
export const getProjectStatus = async (
  params: GetProjectStatusParams,
): Promise<GetProjectStatusResult> => {
  const { owner, repo, issueNumber, graphql } = params;
  const log = params.log ?? ((message: string) => console.log(message));

  try {
    const data = await graphql<IssueProjectStatusData>(
      ISSUE_PROJECT_STATUS_QUERY,
      { owner, repo, number: issueNumber },
    );

    const items = data.repository?.issue?.projectItems.nodes ?? [];
    if (items.length === 0) {
      const reason = `issue #${issueNumber} is on no project board`;
      log(`get-project-status: ${reason}.`);
      return { status: null, reason };
    }

    for (const item of items) {
      const name = item.fieldValueByName?.name;
      if (typeof name === "string" && name.trim() !== "") {
        const label = item.project.title ?? item.project.id;
        log(
          `get-project-status: issue #${issueNumber} is "${name}" on "${label}".`,
        );
        return { status: name };
      }
    }

    const reason = `issue #${issueNumber} has no Status set on any board`;
    log(`get-project-status: ${reason}.`);
    return { status: null, reason };
  } catch (error) {
    const reason = `GraphQL error: ${(error as Error).message}`;
    log(`get-project-status: ${reason}.`);
    return { status: null, reason };
  }
};
