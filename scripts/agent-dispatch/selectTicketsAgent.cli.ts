// Thin CLI wrapper around chooseTickets(), called by the dispatch workflow's
// select job. Reads the enriched issue list as JSON on stdin (the shape produced
// by gh issue list + the status/dependency enrich steps) and prints the chosen
// issue numbers - by default a compact JSON array, so the workflow can hand it
// straight to a matrix via fromJSON().
//
// All selection policy lives in the pure selectTicketsAgent module; this file only
// parses arguments, reads stdin, runs the real `claude` agent, and formats output.
// If the agent is unavailable or returns nothing usable, chooseTickets falls back
// to the deterministic selector, so this step always yields a valid array.
//
// Usage: tsx selectTicketsAgent.cli.ts [--max N] [--format json|lines] [--require-ready-status] < issues.json

import { execFileSync } from "node:child_process";

import { chooseTickets } from "./selectTicketsAgent";
import type { Issue } from "./selectTickets";

type Format = "json" | "lines";

const USAGE =
  "usage: select-tickets-agent [--max N] [--format json|lines] [--require-ready-status] < issues.json";

// Pin Opus 4.8 with the 1M-token context window, matching the worker agent.
const MODEL = "claude-opus-4-8[1m]";
// A selection is a single short reasoning turn; cap it so a hung agent cannot
// stall the whole dispatch run (chooseTickets then falls back deterministically).
const AGENT_TIMEOUT_MS = 120_000;

/** Print to stderr and exit; the `never` return lets callers treat it as fatal. */
const fail = (message: string, code: number): never => {
  process.stderr.write(`select-tickets-agent: ${message}\n`);
  return process.exit(code);
};

const parseArgs = (
  argv: string[],
): { max: number; format: Format; requireReadyStatus: boolean } => {
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

/**
 * Run the real agent. No tools: it only reasons over the prompt and returns text,
 * so the selection step stays sandboxed. Returns null on any failure (binary
 * missing, non-zero exit, timeout) so chooseTickets falls back deterministically.
 */
const runAgent = (prompt: string): string | null => {
  try {
    return execFileSync(
      "claude",
      ["-p", prompt, "--model", MODEL, "--output-format", "text"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 16 * 1024 * 1024,
        timeout: AGENT_TIMEOUT_MS,
      },
    );
  } catch (error) {
    process.stderr.write(
      `select-tickets-agent: agent invocation failed, falling back to deterministic selection: ${
        (error as Error).message
      }\n`,
    );
    return null;
  }
};

const main = async (): Promise<void> => {
  const { max, format, requireReadyStatus } = parseArgs(process.argv.slice(2));
  const issues = parseIssues(await readStdin());
  const numbers = chooseTickets({ issues, max, requireReadyStatus, runAgent });

  if (format === "lines") {
    const body = numbers.join("\n");
    process.stdout.write(body === "" ? "" : `${body}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(numbers)}\n`);
  }
};

main();
