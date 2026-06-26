// Enrich a `gh issue list` JSON payload with each issue's Projects v2 board
// Status, so the ticket selector can gate on the "Ready" column in addition to
// the agent:ready label. Reads the issue array on stdin and writes the same array
// to stdout with a `status` field added to each issue.
//
// Wiring mirrors setProjectStatus.cli: a fetch-backed GraphQL executor
// authenticated with PROJECTS_TOKEN, owner/repo from --repo or GITHUB_REPOSITORY.
// All status logic lives in the pure getProjectStatus() module; this file only
// does stdin/stdout plumbing and auth.
//
// Non-fatal but FAIL CLOSED for the gate: if PROJECTS_TOKEN is unset, owner/repo
// can't be resolved, or a status can't be read, the affected issues are passed
// through with no `status`. Run with selectTickets --require-ready-status, the
// selector then treats them as "not Ready" and skips them. That is deliberate:
// better to auto-pick nothing than to pull a card that is not in the Ready
// column. Diagnostics go to stderr so stdout stays clean JSON for the pipe.
//
// Usage: tsx enrichIssueStatus.cli.ts [--repo owner/name] < issues.json > out.json

import { getProjectStatus } from "./getProjectStatus";
import { makeGithubGraphql } from "./githubGraphql";
import type { Issue } from "./selectTickets";

const USAGE = "usage: enrich-issue-status [--repo owner/name] < issues.json";

/** Diagnostics go to stderr; stdout is reserved for the JSON result. */
const logErr = (message: string): void => {
  process.stderr.write(`enrich-issue-status: ${message}\n`);
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

/** Emit the issues unchanged (no status added) and exit cleanly. */
const passThrough = (issues: Issue[], why: string): void => {
  logErr(`${why} - passing issues through without board status (fail closed).`);
  process.stdout.write(`${JSON.stringify(issues)}\n`);
};

const main = async (): Promise<void> => {
  const { repo: repoArg } = parseArgs(process.argv.slice(2));
  const issues = parseIssues(await readStdin());

  const token = process.env.PROJECTS_TOKEN;
  if (!token || token.trim() === "") {
    return passThrough(issues, "PROJECTS_TOKEN is not set");
  }

  const repo = repoArg ?? process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes("/")) {
    return passThrough(
      issues,
      "could not resolve owner/name from --repo or GITHUB_REPOSITORY",
    );
  }
  const [owner, name] = repo.split("/");
  const graphql = makeGithubGraphql(token);

  // Resolve each issue's board Status. getProjectStatus never throws; an
  // unreadable status comes back null and is simply omitted (-> not Ready).
  const enriched: Issue[] = [];
  for (const issue of issues) {
    const { status } = await getProjectStatus({
      owner,
      repo: name,
      issueNumber: issue.number,
      graphql,
      log: logErr,
    });
    enriched.push(status === null ? issue : { ...issue, status });
  }

  process.stdout.write(`${JSON.stringify(enriched)}\n`);
};

// Stay non-fatal to the end: on any unexpected error, fall back to label-only
// data on stdout so the pipeline keeps a valid JSON array to select from.
main().catch(async (error: unknown) => {
  logErr(`unexpected error: ${(error as Error).message}`);
  process.stdout.write("[]\n");
  process.exit(0);
});
