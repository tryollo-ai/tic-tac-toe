// Move an issue's card on a GitHub Projects v2 board to follow the agent loop's
// lifecycle (claimed -> In Progress, PR open -> In Review). A parked run sets no
// status: the card stays where it is and the agent:needs-help label is the only
// signal. Projects v2 columns are driven by the project's single-select
// "Status" field, not by issue labels, so moving a card means setting that field
// via the GraphQL API - which the default GITHUB_TOKEN cannot write, hence the
// separate PROJECTS_TOKEN (see setProjectStatus.cli.ts).
//
// This module is the pure core: it takes an injected GraphQL executor so it can
// be unit-tested without the network (see setProjectStatus.test.ts). The thin
// CLI wrapper (setProjectStatus.cli.ts) supplies a real fetch-backed executor.
//
// Everything here is BEST-EFFORT and non-fatal: if the issue is on no project,
// or a project has no "Status" field, or no option matches the target name, the
// item is skipped and a clear message is logged. The function never throws and
// never blocks the calling workflow.

/**
 * The board statuses the agent loop drives, mirroring its label lifecycle.
 * Option matching is case-insensitive, so the project's option labels only need
 * to match these by spelling, not casing. `Done` is intentionally absent: the
 * merge -> Done transition is handled natively by GitHub Projects' built-in
 * workflow, not by this helper.
 */
export const BOARD_STATUS = {
  inProgress: "In Progress",
  inReview: "In Review",
} as const;

/**
 * Runs one GraphQL operation and resolves to its `data`. Implementations throw
 * on transport or GraphQL errors; `setProjectStatus` catches everything so a
 * failure degrades to a logged no-op.
 */
export type GraphQLExecutor = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

export type SetProjectStatusParams = {
  owner: string;
  repo: string;
  issueNumber: number;
  /** Target status name, matched against option names case-insensitively. */
  statusName: string;
  graphql: GraphQLExecutor;
  /** Defaults to console.log; injectable so tests can assert on messages. */
  log?: (message: string) => void;
};

export type SetProjectStatusResult = {
  /** How many project items had their Status set this run. */
  updated: number;
  /** Set when nothing was updated, explaining the no-op for the logs. */
  reason?: string;
};

type StatusOption = { id: string; name: string };

type ProjectItem = {
  id: string;
  project: {
    id: string;
    title?: string;
    field: { id: string; options: StatusOption[] } | null;
  };
};

type IssueProjectItemsData = {
  repository: {
    issue: {
      projectItems: { nodes: ProjectItem[] };
    } | null;
  } | null;
};

// Fetch the issue's Projects v2 items, each with its project's "Status"
// single-select field and that field's options. A project with no "Status" field
// yields `field: null`; a "Status" field that is not a single-select type matches
// no inline fragment and yields an empty object with no `options` array. Both are
// skipped.
const ISSUE_PROJECT_ITEMS_QUERY = `
  query IssueProjectItems($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
            id
            project {
              id
              title
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SET_STATUS_MUTATION = `
  mutation SetStatus($project: ID!, $item: ID!, $field: ID!, $option: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $project
        itemId: $item
        fieldId: $field
        value: { singleSelectOptionId: $option }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

/**
 * Set the issue's card to `statusName` on every Projects v2 board it belongs to.
 *
 * Best-effort and non-fatal: returns a result describing what happened (and why
 * it was a no-op, if so) instead of throwing. Callers in the workflow treat any
 * outcome as success.
 */
export const setProjectStatus = async (
  params: SetProjectStatusParams,
): Promise<SetProjectStatusResult> => {
  const { owner, repo, issueNumber, statusName, graphql } = params;
  const log = params.log ?? ((message: string) => console.log(message));
  const target = statusName.trim().toLowerCase();

  try {
    const data = await graphql<IssueProjectItemsData>(
      ISSUE_PROJECT_ITEMS_QUERY,
      { owner, repo, number: issueNumber },
    );

    const items = data.repository?.issue?.projectItems.nodes ?? [];
    if (items.length === 0) {
      const reason = `issue #${issueNumber} is on no project board`;
      log(`set-project-status: skipped - ${reason}.`);
      return { updated: 0, reason };
    }

    let updated = 0;
    for (const item of items) {
      const project = item.project;
      const label = project.title ?? project.id;
      const field = project.field;
      if (!field || !Array.isArray(field.options)) {
        log(
          `set-project-status: skipped project "${label}" - no "Status" single-select field.`,
        );
        continue;
      }
      const option = field.options.find(
        (candidate) => candidate.name.trim().toLowerCase() === target,
      );
      if (!option) {
        log(
          `set-project-status: skipped project "${label}" - no Status option matching "${statusName}".`,
        );
        continue;
      }

      await graphql(SET_STATUS_MUTATION, {
        project: project.id,
        item: item.id,
        field: field.id,
        option: option.id,
      });
      log(
        `set-project-status: set "${label}" Status to "${option.name}" for issue #${issueNumber}.`,
      );
      updated += 1;
    }

    if (updated === 0) {
      const reason = `no project had a Status option matching "${statusName}"`;
      return { updated, reason };
    }
    return { updated };
  } catch (error) {
    const reason = `GraphQL error: ${(error as Error).message}`;
    log(`set-project-status: skipped - ${reason}.`);
    return { updated: 0, reason };
  }
};
