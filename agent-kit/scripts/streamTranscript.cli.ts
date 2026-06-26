// Live transcript filter for the direct-CLI agent step. Reads claude's
// `--output-format stream-json` NDJSON on stdin and prints a clean, plain-text,
// turn-by-turn transcript on stdout - assistant text plus one line per tool
// call - while dropping the token/cost firehose (system events, tool-result
// blocks, and the usage/cost fields on the result event). Because the agent step
// runs this in a foreground `run:` pipeline, GitHub streams these lines to the
// live job log as each turn happens, so you watch the run instead of waiting for
// the end-of-run summary.
//
// Raw NDJSON is teed to a file upstream (for the end-of-run report); this filter
// only formats for humans. It reads line-by-line so output appears incrementally,
// and never throws on a malformed line - a bad line just produces no output.

import { createInterface } from "node:readline";
import { formatStreamLines, type RunEvent } from "./agentRunReport";

const parseLine = (line: string): RunEvent | null => {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RunEvent)
      : null;
  } catch {
    return null;
  }
};

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const event = parseLine(line);
  if (event === null) return;
  for (const out of formatStreamLines(event)) {
    process.stdout.write(`${out}\n`);
  }
});
