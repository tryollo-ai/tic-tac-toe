// Thin CLI wrapper around selectTickets(), called by the dispatch workflow.
//
// Reads a GitHub issue list as JSON on stdin (the shape produced by
//   gh issue list --json number,title,labels,createdAt,state)
// and prints the chosen issue numbers - by default as a compact JSON array, so
// the workflow can hand it straight to a matrix via fromJSON(). All selection
// logic lives in the pure selectTickets() module; this file only does argument
// parsing, stdin reading, and formatting.
//
// Usage: tsx selectTickets.cli.ts [--max N] [--format json|lines] [--require-ready-status] < issues.json
//
// With --require-ready-status, an issue must also carry a board Status of "Ready"
// (its `status` field, populated upstream by enrichIssueStatus.cli) to be picked.

import { selectTickets, type Issue } from "./selectTickets";

type Format = "json" | "lines";

const USAGE =
  "usage: select-tickets [--max N] [--format json|lines] [--require-ready-status] < issues.json";

/** Print to stderr and exit; the `never` return lets callers treat it as fatal. */
const fail = (message: string, code: number): never => {
  process.stderr.write(`select-tickets: ${message}\n`);
  process.exit(code);
};

const parseArgs = (
  argv: string[],
): { max: number; format: Format; requireReadyStatus: boolean } => {
  // FM_AGENT_MAX_TICKETS mirrors the env override documented for the loop; the
  // workflow passes --max explicitly, which takes precedence.
  let maxRaw = process.env.FM_AGENT_MAX_TICKETS ?? "3";
  let format: Format = "json";
  let requireReadyStatus = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--max": {
        const value = argv[i + 1];
        if (value === undefined) fail("--max needs a value", 2);
        maxRaw = value;
        i += 2;
        break;
      }
      case "--format": {
        const value = argv[i + 1];
        if (value === "json" || value === "lines") {
          format = value;
        } else {
          fail("--format must be json or lines", 2);
        }
        i += 2;
        break;
      }
      case "--require-ready-status":
        requireReadyStatus = true;
        i += 1;
        break;
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        return process.exit(0);
      default:
        fail(`unknown argument: ${arg}`, 2);
    }
  }

  if (!/^\d+$/.test(maxRaw)) {
    fail("--max must be a non-negative integer", 2);
  }
  return { max: Number(maxRaw), format, requireReadyStatus };
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

const main = async (): Promise<void> => {
  const { max, format, requireReadyStatus } = parseArgs(process.argv.slice(2));
  const issues = parseIssues(await readStdin());
  const numbers = selectTickets(issues, { max, requireReadyStatus });

  if (format === "lines") {
    const body = numbers.join("\n");
    process.stdout.write(body === "" ? "" : `${body}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(numbers)}\n`);
  }
};

main();
