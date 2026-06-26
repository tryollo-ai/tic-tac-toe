// Thin CLI wrapper around setProjectStatus(), called by the agent-dispatch
// workflows as a best-effort step to move an issue's card on the Projects v2
// board (e.g. to "In Progress" right after claiming a ticket).
//
// All board logic lives in the pure setProjectStatus() module; this file only
// parses arguments, wires up a real fetch-backed GraphQL executor authenticated
// with PROJECTS_TOKEN, and guarantees the whole thing is non-fatal: it ALWAYS
// exits 0, logging a clear message on any skip or error, so it can never fail
// the workflow job that calls it. The calling step additionally sets
// `continue-on-error: true` as a second belt-and-braces guard.
//
// Usage: tsx setProjectStatus.cli.ts --issue N --status "In Progress" [--repo owner/name]
//   - PROJECTS_TOKEN  (required to do anything; unset -> logged no-op, exit 0)
//   - GITHUB_REPOSITORY  (owner/name; used when --repo is omitted)

import { setProjectStatus } from "./setProjectStatus";
import { makeGithubGraphql } from "./githubGraphql";

const USAGE =
  'usage: set-project-status --issue N --status "In Progress" [--repo owner/name]';

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/** Log to stderr and exit non-zero - reserved for usage errors only. */
const fail = (message: string): never => {
  process.stderr.write(`set-project-status: ${message}\n`);
  return process.exit(2);
};

type Args = { issue: number; status: string; repo?: string };

const parseArgs = (argv: string[]): Args => {
  let issueRaw: string | undefined;
  let status: string | undefined;
  let repo: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--issue": {
        issueRaw = argv[i + 1];
        if (issueRaw === undefined) fail("--issue needs a value");
        i += 2;
        break;
      }
      case "--status": {
        status = argv[i + 1];
        if (status === undefined) fail("--status needs a value");
        i += 2;
        break;
      }
      case "--repo": {
        repo = argv[i + 1];
        if (repo === undefined) fail("--repo needs a value");
        i += 2;
        break;
      }
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        return process.exit(0);
      default:
        fail(`unknown argument: ${arg}`);
    }
  }

  if (issueRaw === undefined || !/^\d+$/.test(issueRaw)) {
    fail("--issue must be a positive integer");
  }
  if (status === undefined || status.trim() === "") {
    fail("--status must be a non-empty status name");
  }
  return { issue: Number(issueRaw), status: status as string, repo };
};

const main = async (): Promise<void> => {
  const { issue, status, repo: repoArg } = parseArgs(process.argv.slice(2));

  const token = process.env.PROJECTS_TOKEN;
  if (!token || token.trim() === "") {
    log("set-project-status: skipped - PROJECTS_TOKEN is not set. Board sync is optional.");
    return;
  }

  const repo = repoArg ?? process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes("/")) {
    log(
      "set-project-status: skipped - could not resolve owner/name from --repo or GITHUB_REPOSITORY.",
    );
    return;
  }
  const [owner, name] = repo.split("/");

  await setProjectStatus({
    owner,
    repo: name,
    issueNumber: issue,
    statusName: status,
    graphql: makeGithubGraphql(token),
    log,
  });
};

// Best-effort to the end: never let an unexpected error fail the calling job.
main().catch((error: unknown) => {
  log(
    `set-project-status: skipped - unexpected error: ${(error as Error).message}`,
  );
  process.exit(0);
});
