// Enrich a `gh issue list` JSON payload with each issue's resolved blocker states.
//
// Reads the issue array on stdin (which must include `body`, e.g.
//   gh issue list --json number,title,labels,createdAt,state,body) and resolves
// each issue's blockers from two sources, merged into a single `blockedBy:
// [{number,state}]` field the selector consumes:
//   1. GitHub's NATIVE issue dependencies (the "Blocked by" relationships set in
//      the issue UI), read via GraphQL `Issue.blockedBy` - the primary source.
//   2. "Blocked by #N" / "Depends on #N" relations parsed from the body, for
//      whoever writes the dependency in prose instead.
// The selector then skips any issue with a blocker that is not yet CLOSED.
//
// Fail closed: if the native read errors, or GitHub counts more blockers than it
// returned (cross-repo / paged out), the issue carries UNKNOWN blockers that still
// block; a body ref whose state cannot be read is UNKNOWN too. An issue with no
// blockers from either source passes through untouched. Diagnostics go to stderr;
// stdout stays clean JSON for the pipe.
//
// Usage: tsx enrichDependencies.cli.ts [--repo owner/name] < issues.json > out.json

import {
  parseBlockerRefs,
  resolveBlockedBy,
  type NativeBlockers,
} from "./dependencies";
import { makeGithubGraphql } from "./githubGraphql";
import type { BlockerRef, Issue } from "./selectTickets";
import type { GraphQLExecutor } from "./setProjectStatus";

const USAGE = "usage: enrich-dependencies [--repo owner/name] < issues.json";

/** Diagnostics go to stderr; stdout is reserved for the JSON result. */
const logErr = (message: string): void => {
  process.stderr.write(`enrich-dependencies: ${message}\n`);
};

const fail = (message: string, code: number): never => {
  logErr(message);
  return process.exit(code);
};

const parseArgs = (argv: string[]): { repo?: string } => {
  let repo: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--repo": {
        const value = argv[i + 1];
        if (value === undefined) fail("--repo needs a value", 2);
        repo = value;
        i += 2;
        break;
      }
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        return process.exit(0);
      default:
        fail(`unknown argument: ${arg}`, 2);
    }
  }
  return { repo };
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseIssues = (raw: string): Issue[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() === "" ? "[]" : raw);
  } catch (error) {
    return fail(
      `could not parse issue JSON on stdin: ${(error as Error).message}`,
      3,
    );
  }
  if (!Array.isArray(parsed)) {
    return fail("expected a JSON array of issues on stdin", 3);
  }
  return parsed as Issue[];
};

const upper = (state: unknown): string => String(state ?? "UNKNOWN").toUpperCase();

type IssueNode = {
  number: number;
  blockedBy?: { nodes?: ({ number: number; state: string } | null)[] };
  issueDependenciesSummary?: { totalBlockedBy?: number };
} | null;

/**
 * Read each candidate issue's native "Blocked by" dependencies (and GitHub's own
 * blocker count) in chunked GraphQL round trips. Issue numbers are plain digits,
 * safe to interpolate as field aliases. A chunk that errors marks its issues
 * `"error"` so the caller fails them closed. Never throws.
 */
const fetchNativeBlockers = async (
  graphql: GraphQLExecutor,
  owner: string,
  name: string,
  numbers: number[],
): Promise<Map<number, NativeBlockers>> => {
  const result = new Map<number, NativeBlockers>();
  const chunkSize = 25;
  for (let start = 0; start < numbers.length; start += chunkSize) {
    const chunk = numbers.slice(start, start + chunkSize);
    const fields = chunk
      .map(
        (n) =>
          `i${n}: issue(number: ${n}) { number blockedBy(first: 50) { nodes { number state } } issueDependenciesSummary { totalBlockedBy } }`,
      )
      .join("\n");
    const query = `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${fields}
      }
    }`;
    try {
      const data = await graphql<{ repository: Record<string, IssueNode> }>(
        query,
        { owner, name },
      );
      // Default every requested number to "no blockers"; nodes that come back
      // overwrite this. An issue the API omits stays unblocked rather than erroring.
      for (const n of chunk) result.set(n, { blockers: [], total: 0 });
      const repository = data?.repository ?? {};
      for (const node of Object.values(repository)) {
        if (!node || typeof node.number !== "number") continue;
        const blockers: BlockerRef[] = (node.blockedBy?.nodes ?? [])
          .filter((b): b is { number: number; state: string } => b != null)
          .map((b) => ({ number: b.number, state: upper(b.state) }));
        const total = node.issueDependenciesSummary?.totalBlockedBy ?? blockers.length;
        result.set(node.number, { blockers, total });
      }
    } catch (error) {
      logErr(
        `could not read native blockers for [${chunk.join(", ")}]: ${
          (error as Error).message
        } - treating them as blocked (UNKNOWN, fail closed).`,
      );
      for (const n of chunk) result.set(n, "error");
    }
  }
  return result;
};

/**
 * Resolve the open/closed state of body-declared blocker refs (the native source
 * already carries state). One chunked GraphQL read. Unreadable refs are simply
 * absent from the map, so the caller records them UNKNOWN. Never throws.
 */
const fetchBodyRefStates = async (
  graphql: GraphQLExecutor,
  owner: string,
  name: string,
  numbers: number[],
): Promise<Map<number, string>> => {
  const states = new Map<number, string>();
  const chunkSize = 50;
  for (let start = 0; start < numbers.length; start += chunkSize) {
    const chunk = numbers.slice(start, start + chunkSize);
    const fields = chunk
      .map((n) => `i${n}: issue(number: ${n}) { number state }`)
      .join("\n");
    const query = `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${fields}
      }
    }`;
    try {
      const data = await graphql<{
        repository: Record<string, { number: number; state: string } | null>;
      }>(query, { owner, name });
      for (const node of Object.values(data?.repository ?? {})) {
        if (node && typeof node.number === "number") {
          states.set(node.number, upper(node.state));
        }
      }
    } catch (error) {
      logErr(
        `could not resolve body-ref states for [${chunk.join(", ")}]: ${
          (error as Error).message
        } - treating them as UNKNOWN (blocking).`,
      );
    }
  }
  return states;
};

const main = async (): Promise<void> => {
  const { repo: repoArg } = parseArgs(process.argv.slice(2));
  const issues = parseIssues(await readStdin());

  // Body refs up front (offline). Native deps and body-ref states are the network
  // reads below; both default to fail-closed when they cannot run.
  const bodyRefsByIssue = new Map<number, number[]>();
  const allBodyRefs = new Set<number>();
  for (const issue of issues) {
    const refs = parseBlockerRefs(issue.body);
    bodyRefsByIssue.set(issue.number, refs);
    for (const ref of refs) allBodyRefs.add(ref);
  }

  let native = new Map<number, NativeBlockers>();
  let bodyStates = new Map<number, string>();

  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const repo = repoArg ?? process.env.GITHUB_REPOSITORY;
  if (!token || token.trim() === "") {
    logErr(
      "no GH_TOKEN/GITHUB_TOKEN set - cannot read dependencies; failing every issue closed.",
    );
    for (const issue of issues) native.set(issue.number, "error");
  } else if (!repo || !repo.includes("/")) {
    logErr(
      "could not resolve owner/name from --repo or GITHUB_REPOSITORY - failing every issue closed.",
    );
    for (const issue of issues) native.set(issue.number, "error");
  } else {
    const [owner, name] = repo.split("/");
    const graphql = makeGithubGraphql(token);
    native = await fetchNativeBlockers(
      graphql,
      owner,
      name,
      issues.map((issue) => issue.number),
    );
    if (allBodyRefs.size > 0) {
      bodyStates = await fetchBodyRefStates(graphql, owner, name, [
        ...allBodyRefs,
      ]);
    }
  }

  const enriched = issues.map((issue) => {
    const blockedBy = resolveBlockedBy(
      native.get(issue.number) ?? "error",
      bodyRefsByIssue.get(issue.number) ?? [],
      bodyStates,
    );
    return blockedBy.length === 0 ? issue : { ...issue, blockedBy };
  });

  process.stdout.write(`${JSON.stringify(enriched)}\n`);
};

// Stay non-fatal: on any unexpected error, emit an empty array so the pipeline
// still has valid JSON to select from (and selects nothing rather than crashing).
main().catch((error: unknown) => {
  logErr(`unexpected error: ${(error as Error).message}`);
  process.stdout.write("[]\n");
  process.exit(0);
});
