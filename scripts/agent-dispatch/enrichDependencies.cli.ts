// Enrich a `gh issue list` JSON payload with each issue's resolved blocker states.
//
// Reads the issue array on stdin (which must include `body`, e.g.
//   gh issue list --json number,title,labels,createdAt,state,body), parses every
// body for "Blocked by #N" / "Depends on #N" relations (see dependencies.ts),
// resolves each referenced issue's open/closed state in one GraphQL round trip,
// and writes the same array back with a `blockedBy: [{number,state}]` field on
// each issue that declares blockers. The selector then skips any issue with a
// blocker that is not yet CLOSED.
//
// Fail closed, but only for issues that actually declare blockers: a blocker whose
// state cannot be read is recorded as "UNKNOWN", which the selector treats as
// still-blocking. Issues with no declared blockers pass through untouched, so a
// missing token or API hiccup never stalls independent tickets. Diagnostics go to
// stderr; stdout stays clean JSON for the pipe.
//
// Usage: tsx enrichDependencies.cli.ts [--repo owner/name] < issues.json > out.json

import { parseBlockerRefs } from "./dependencies";
import { makeGithubGraphql } from "./githubGraphql";
import type { BlockerRef, Issue } from "./selectTickets";

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

type IssueStateNode = { number: number; state: string } | null;

/**
 * Resolve the open/closed state of every referenced blocker in one GraphQL round
 * trip (chunked to keep each query bounded). Issue numbers come from a `#(\d+)`
 * match so they are always plain digits - safe to interpolate as field aliases.
 * Any blocker the query does not return is simply left out of the map, so the
 * caller records it as UNKNOWN (fail closed). Never throws: a transport/GraphQL
 * error yields an empty map and a stderr note.
 */
const resolveBlockerStates = async (
  numbers: number[],
  owner: string,
  name: string,
  token: string,
): Promise<Map<number, string>> => {
  const states = new Map<number, string>();
  if (numbers.length === 0) return states;
  const graphql = makeGithubGraphql(token);

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
        repository: Record<string, IssueStateNode>;
      }>(query, { owner, name });
      const repository = data?.repository ?? {};
      for (const node of Object.values(repository)) {
        if (node && typeof node.number === "number") {
          states.set(node.number, String(node.state ?? "UNKNOWN").toUpperCase());
        }
      }
    } catch (error) {
      logErr(
        `could not resolve blocker states for [${chunk.join(", ")}]: ${
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

  // Parse blockers up front so we can both batch the state lookup and annotate
  // even if the lookup yields nothing (every blocker then records as UNKNOWN).
  const refsByIssue = new Map<number, number[]>();
  const allRefs = new Set<number>();
  for (const issue of issues) {
    const refs = parseBlockerRefs(issue.body);
    refsByIssue.set(issue.number, refs);
    for (const ref of refs) allRefs.add(ref);
  }

  let states = new Map<number, string>();
  if (allRefs.size > 0) {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    const repo = repoArg ?? process.env.GITHUB_REPOSITORY;
    if (!token || token.trim() === "") {
      logErr(
        "no GH_TOKEN/GITHUB_TOKEN set - blocker states unresolved (all UNKNOWN, blocking).",
      );
    } else if (!repo || !repo.includes("/")) {
      logErr(
        "could not resolve owner/name from --repo or GITHUB_REPOSITORY - blocker states unresolved (all UNKNOWN, blocking).",
      );
    } else {
      const [owner, name] = repo.split("/");
      states = await resolveBlockerStates([...allRefs], owner, name, token);
    }
  }

  const enriched = issues.map((issue) => {
    const refs = refsByIssue.get(issue.number) ?? [];
    if (refs.length === 0) return issue;
    const blockedBy: BlockerRef[] = refs.map((number) => ({
      number,
      state: states.get(number) ?? "UNKNOWN",
    }));
    return { ...issue, blockedBy };
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
