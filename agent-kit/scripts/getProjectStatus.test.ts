import { describe, expect, it, vi } from "vitest";
import {
  getProjectStatus,
  type GetProjectStatusParams,
} from "./getProjectStatus";
import type { GraphQLExecutor } from "./setProjectStatus";

/** A project item as the issue-status query returns it. */
type ItemFixture = {
  projectId: string;
  title?: string;
  /** The Status option name; omit/null for a card with no Status set. */
  status?: string | null;
};

const statusResponse = (items: ItemFixture[]) => ({
  repository: {
    issue: {
      projectItems: {
        nodes: items.map((item) => ({
          project: { id: item.projectId, title: item.title },
          fieldValueByName:
            item.status === undefined || item.status === null
              ? {} // not single-select / unset -> empty inline fragment
              : { name: item.status },
        })),
      },
    },
  },
});

/** A mock executor returning the given items for the status query. */
const mockGraphql = (items: ItemFixture[]): GraphQLExecutor =>
  (async () => statusResponse(items)) as GraphQLExecutor;

const baseParams: Omit<GetProjectStatusParams, "graphql"> = {
  owner: "puopg",
  repo: "tic-tac-toe",
  issueNumber: 42,
};

describe("getProjectStatus", () => {
  it("returns the Status of the issue's card", async () => {
    const graphql = mockGraphql([
      { projectId: "proj-1", title: "Board", status: "Ready" },
    ]);
    const result = await getProjectStatus({ ...baseParams, graphql, log: () => {} });
    expect(result).toEqual({ status: "Ready" });
  });

  it("returns the first card that has a Status set across multiple boards", async () => {
    const graphql = mockGraphql([
      { projectId: "proj-a", status: null },
      { projectId: "proj-b", status: "Backlog" },
    ]);
    const result = await getProjectStatus({ ...baseParams, graphql, log: () => {} });
    expect(result.status).toBe("Backlog");
  });

  it("returns null when the issue is on no project board", async () => {
    const graphql = mockGraphql([]);
    const log = vi.fn();
    const result = await getProjectStatus({ ...baseParams, graphql, log });
    expect(result.status).toBeNull();
    expect(result.reason).toMatch(/no project board/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no project board"));
  });

  it("returns null when no card has a Status value set", async () => {
    const graphql = mockGraphql([{ projectId: "proj-1", status: null }]);
    const log = vi.fn();
    const result = await getProjectStatus({ ...baseParams, graphql, log });
    expect(result.status).toBeNull();
    expect(result.reason).toMatch(/no Status set/);
  });

  it("never throws when the GraphQL executor errors - it returns null", async () => {
    const graphql = (async () => {
      throw new Error("network down");
    }) as GraphQLExecutor;
    const log = vi.fn();
    const result = await getProjectStatus({ ...baseParams, graphql, log });
    expect(result.status).toBeNull();
    expect(result.reason).toMatch(/network down/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });
});
