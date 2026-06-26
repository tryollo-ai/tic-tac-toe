// A fetch-backed GitHub GraphQL executor shared by the agent-dispatch CLIs that talk
// to Projects v2 - setProjectStatus.cli (write the card's Status) and
// enrichIssueStatus.cli (read it). Authenticated with a token (PROJECTS_TOKEN,
// since the default GITHUB_TOKEN cannot reach user/org Projects v2).
//
// It throws on transport or GraphQL errors so the pure callers (setProjectStatus,
// getProjectStatus) can catch and degrade to a logged no-op rather than this
// transport layer deciding policy.

import type { GraphQLExecutor } from "./setProjectStatus";

export const makeGithubGraphql = (token: string): GraphQLExecutor => {
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "tic-tac-toe-agent-loop",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (body.errors && body.errors.length > 0) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    return body.data as T;
  };
};
