import { describe, expect, it, vi } from "vitest";
import {
  BOARD_STATUS,
  setProjectStatus,
  type GraphQLExecutor,
} from "./setProjectStatus";

/** A project item as the issue-items query returns it. */
type ItemFixture = {
  id: string;
  projectId: string;
  title?: string;
  fieldId?: string | null;
  options?: { id: string; name: string }[];
};

const itemsResponse = (items: ItemFixture[]) => ({
  repository: {
    issue: {
      projectItems: {
        nodes: items.map((item) => ({
          id: item.id,
          project: {
            id: item.projectId,
            title: item.title,
            field:
              item.fieldId === null
                ? null
                : { id: item.fieldId ?? "field-1", options: item.options ?? [] },
          },
        })),
      },
    },
  },
});

const isMutation = (query: string): boolean =>
  query.includes("updateProjectV2ItemFieldValue");

/**
 * Build a mock executor: the first (query) call returns the given items, and
 * every mutation call resolves successfully. Captures the variables passed to
 * each mutation so tests can assert on what was set.
 */
const mockGraphql = (
  items: ItemFixture[],
): { graphql: GraphQLExecutor; mutations: Record<string, unknown>[] } => {
  const mutations: Record<string, unknown>[] = [];
  const graphql = (async (query: string, variables: Record<string, unknown>) => {
    if (isMutation(query)) {
      mutations.push(variables);
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: "x" } } };
    }
    return itemsResponse(items);
  }) as GraphQLExecutor;
  return { graphql, mutations };
};

const baseParams = {
  owner: "puopg",
  repo: "tic-tac-toe",
  issueNumber: 42,
  statusName: BOARD_STATUS.inProgress,
};

describe("setProjectStatus", () => {
  it("sets the Status option matching the target name", async () => {
    const { graphql, mutations } = mockGraphql([
      {
        id: "item-1",
        projectId: "proj-1",
        title: "Board",
        fieldId: "status-field",
        options: [
          { id: "opt-todo", name: "Todo" },
          { id: "opt-prog", name: "In Progress" },
        ],
      },
    ]);

    const result = await setProjectStatus({ ...baseParams, graphql, log: () => {} });

    expect(result).toEqual({ updated: 1 });
    expect(mutations).toEqual([
      {
        project: "proj-1",
        item: "item-1",
        field: "status-field",
        option: "opt-prog",
      },
    ]);
  });

  it("matches the option name case-insensitively", async () => {
    const { graphql, mutations } = mockGraphql([
      {
        id: "item-1",
        projectId: "proj-1",
        options: [{ id: "opt-review", name: "in REVIEW" }],
      },
    ]);

    const result = await setProjectStatus({
      ...baseParams,
      statusName: "In Review",
      graphql,
      log: () => {},
    });

    expect(result.updated).toBe(1);
    expect(mutations[0].option).toBe("opt-review");
  });

  it("updates the card on every project the issue belongs to", async () => {
    const { graphql, mutations } = mockGraphql([
      {
        id: "item-a",
        projectId: "proj-a",
        options: [{ id: "a-prog", name: "In Progress" }],
      },
      {
        id: "item-b",
        projectId: "proj-b",
        options: [{ id: "b-prog", name: "In Progress" }],
      },
    ]);

    const result = await setProjectStatus({ ...baseParams, graphql, log: () => {} });

    expect(result.updated).toBe(2);
    expect(mutations.map((m) => m.item)).toEqual(["item-a", "item-b"]);
  });

  it("no-ops when the issue is on no project board", async () => {
    const { graphql, mutations } = mockGraphql([]);
    const log = vi.fn();

    const result = await setProjectStatus({ ...baseParams, graphql, log });

    expect(result.updated).toBe(0);
    expect(result.reason).toMatch(/no project board/);
    expect(mutations).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no project board"));
  });

  it("skips a project that has no Status single-select field", async () => {
    const { graphql, mutations } = mockGraphql([
      { id: "item-1", projectId: "proj-1", fieldId: null },
    ]);
    const log = vi.fn();

    const result = await setProjectStatus({ ...baseParams, graphql, log });

    expect(result.updated).toBe(0);
    expect(mutations).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('no "Status" single-select field'),
    );
  });

  it("skips a Status field that is not single-select (empty inline fragment)", async () => {
    const mutations: Record<string, unknown>[] = [];
    const graphql = (async (query: string, variables: Record<string, unknown>) => {
      if (isMutation(query)) {
        mutations.push(variables);
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: "x" } } };
      }
      return {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                { id: "item-1", project: { id: "proj-1", title: "Board", field: {} } },
              ],
            },
          },
        },
      };
    }) as GraphQLExecutor;
    const log = vi.fn();

    const result = await setProjectStatus({ ...baseParams, graphql, log });

    expect(result.updated).toBe(0);
    expect(mutations).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('no "Status" single-select field'),
    );
  });

  it("skips a project with no option matching the target status", async () => {
    const { graphql, mutations } = mockGraphql([
      {
        id: "item-1",
        projectId: "proj-1",
        options: [{ id: "opt-todo", name: "Todo" }],
      },
    ]);
    const log = vi.fn();

    const result = await setProjectStatus({
      ...baseParams,
      statusName: "No Such Status",
      graphql,
      log,
    });

    expect(result.updated).toBe(0);
    expect(result.reason).toMatch(/No Such Status/);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("no Status option matching"),
    );
  });

  it("never throws when the GraphQL executor errors - it degrades to a no-op", async () => {
    const graphql = (async () => {
      throw new Error("network down");
    }) as GraphQLExecutor;
    const log = vi.fn();

    const result = await setProjectStatus({ ...baseParams, graphql, log });

    expect(result.updated).toBe(0);
    expect(result.reason).toMatch(/network down/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });
});
