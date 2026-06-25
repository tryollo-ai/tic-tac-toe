// Thin CLI around agentRunReport(), called by the dispatch workflow to turn the
// claude-code-action `execution_file` into something a human reads. Two modes:
//
//   --mode transcript --execution-file <path> [--title "Agent run - issue #N"]
//     Prints a markdown transcript (the workflow appends it to $GITHUB_STEP_SUMMARY).
//
//   --mode comment --execution-file <path> --outcome <success|failure> --run-url <url>
//     Prints the parked-ticket comment (the workflow posts it with --body-file).
//
// All formatting lives in the pure agentRunReport module; this file only parses
// args, reads the file, and prints. It is defensive: a missing, empty, or
// malformed execution_file is treated as "no events", never an error, so a
// timed-out run still produces a sensible transcript and comment.

import { readFileSync } from "node:fs";
import {
  extractResult,
  formatParkComment,
  formatTranscript,
  parseEvents,
  type RunEvent,
} from "./agentRunReport";

type Mode = "transcript" | "comment";

const USAGE =
  'usage: agent-run-report --mode transcript|comment --execution-file <path> ' +
  '[--title <text>] [--outcome <success|failure>] [--run-url <url>]';

const fail = (message: string): never => {
  process.stderr.write(`agent-run-report: ${message}\n`);
  return process.exit(2);
};

type Args = {
  mode: Mode;
  executionFile: string;
  title: string;
  outcome: string;
  runUrl: string;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    mode: "transcript",
    executionFile: "",
    title: "Agent run",
    outcome: "",
    runUrl: "",
  };

  let i = 0;
  const next = (flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined) fail(`${flag} needs a value`);
    i += 2;
    return value as string;
  };

  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--mode": {
        const value = next(arg);
        if (value !== "transcript" && value !== "comment") {
          fail("--mode must be transcript or comment");
        }
        args.mode = value as Mode;
        break;
      }
      case "--execution-file":
        args.executionFile = next(arg);
        break;
      case "--title":
        args.title = next(arg);
        break;
      case "--outcome":
        args.outcome = next(arg);
        break;
      case "--run-url":
        args.runUrl = next(arg);
        break;
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        return process.exit(0);
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return args;
};

/** Read the execution_file, treating any read/parse problem as no events. */
const readEvents = (path: string): RunEvent[] => {
  if (path.trim() === "") return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseEvents(raw);
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const events = readEvents(args.executionFile);

  if (args.mode === "transcript") {
    const transcript = formatTranscript(events);
    const body =
      transcript === ""
        ? "_No transcript was captured for this run (it may have failed or timed out before producing output)._"
        : transcript;
    process.stdout.write(`## ${args.title}\n\n${body}\n`);
    return;
  }

  // mode === "comment"
  process.stdout.write(
    `${formatParkComment({
      outcome: args.outcome,
      result: extractResult(events),
      runUrl: args.runUrl,
    })}\n`,
  );
};

main();
