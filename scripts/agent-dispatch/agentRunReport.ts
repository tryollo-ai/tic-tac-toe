// Turn an `anthropics/claude-code-action@v1` run into something a human can read.
//
// The action writes its `execution_file` output: a JSON array of run events
// (system/init, assistant, user/tool-result, result). This module is the pure
// core that the dispatch workflow uses for two things:
//
//   - formatTranscript(events) -> a clean markdown back-and-forth (assistant text
//     plus one compact line per tool call), with the noisy tool-result blocks
//     dropped, for the run's Summary tab.
//   - extractResult(events)    -> the agent's final message (its own "why I
//     stopped" explanation), for the parked-ticket comment.
//
// Everything here is pure and defensive: it never throws on a malformed or
// partial file (a timed-out run can leave one), so the thin CLI wrapper can rely
// on it without try/catch around the parsing itself. See agentRunReport.test.ts.

/** One content block inside an assistant/user message. Shapes vary, so every
 * field is optional and we read defensively. */
export type ContentBlock = {
  type?: string;
  /** Present on text blocks. */
  text?: string;
  /** Present on tool_use blocks. */
  name?: string;
  input?: Record<string, unknown>;
};

/** One entry in the execution_file array. Only the fields we read are typed. */
export type RunEvent = {
  type?: string;
  subtype?: string;
  /** The final summary text, present on the `result` event. */
  result?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
  };
};

/** Keys whose value best labels a tool call, tried in order. */
const TOOL_ARG_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "url",
  "prompt",
  "description",
] as const;

/** Longest tool-argument label we keep on a transcript line. */
const TOOL_ARG_MAX = 80;

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** A short, single-line label for a tool call, e.g. `npm test` or a file path. */
const summarizeToolArg = (input: Record<string, unknown> | undefined): string => {
  if (!input) return "";
  for (const key of TOOL_ARG_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") {
      const firstLine = value.trim().split("\n")[0];
      return firstLine.length > TOOL_ARG_MAX
        ? `${firstLine.slice(0, TOOL_ARG_MAX - 1)}…`
        : firstLine;
    }
  }
  return "";
};

const contentBlocks = (event: RunEvent): ContentBlock[] => {
  const content = event.message?.content;
  return Array.isArray(content) ? content : [];
};

/**
 * Render the run as a readable markdown transcript: assistant prose plus a
 * compact `- tool: arg` line per tool call, and the final result. Tool-result
 * blocks (the metadata firehose) and system events are dropped. Returns an empty
 * string when there is nothing to show.
 */
export const formatTranscript = (events: RunEvent[]): string => {
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === "assistant") {
      for (const block of contentBlocks(event)) {
        if (block.type === "text") {
          const text = asString(block.text).trim();
          if (text !== "") lines.push(`**Claude:** ${text}`);
        } else if (block.type === "tool_use") {
          const name = asString(block.name) || "tool";
          const arg = summarizeToolArg(block.input);
          lines.push(arg === "" ? `- \`${name}\`` : `- \`${name}\`: ${arg}`);
        }
      }
    } else if (event.type === "result") {
      const text = asString(event.result).trim();
      if (text !== "") lines.push(`**Claude (final):** ${text}`);
    }
    // system + user/tool-result events are intentionally omitted.
  }

  return lines.join("\n\n");
};

/**
 * Format a single run event into clean, plain-text lines for a LIVE log: the
 * direct-CLI agent step pipes claude's `--output-format stream-json` NDJSON
 * through this so each turn prints as it happens. Same selection as
 * formatTranscript - assistant prose plus one line per tool call, and the final
 * result - but plain text (no markdown) and per-event. System events, tool-result
 * blocks, and the result event's usage/cost fields produce no lines, so the
 * token/cost firehose never reaches the log. Returns [] when the event is silent.
 */
export const formatStreamLines = (event: RunEvent): string[] => {
  const lines: string[] = [];

  if (event.type === "assistant") {
    for (const block of contentBlocks(event)) {
      if (block.type === "text") {
        const text = asString(block.text).trim();
        if (text !== "") lines.push(`Claude: ${text}`);
      } else if (block.type === "tool_use") {
        const name = asString(block.name) || "tool";
        const arg = summarizeToolArg(block.input);
        lines.push(arg === "" ? `  -> ${name}` : `  -> ${name}: ${arg}`);
      }
    }
  } else if (event.type === "result") {
    const text = asString(event.result).trim();
    if (text !== "") lines.push(`Claude (final): ${text}`);
  }

  return lines;
};

/**
 * The agent's final message - preferring the `result` event, falling back to the
 * last assistant text block (a timed-out run may have no `result`). Returns null
 * when neither is present, so the caller can post a generic message instead.
 */
export const extractResult = (events: RunEvent[]): string | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const text = asString(events[i].result).trim();
    if (events[i].type === "result" && text !== "") return text;
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type !== "assistant") continue;
    const texts = contentBlocks(events[i])
      .filter((block) => block.type === "text")
      .map((block) => asString(block.text).trim())
      .filter((text) => text !== "");
    if (texts.length > 0) return texts.join("\n\n");
  }

  return null;
};

/**
 * Parse raw execution_file contents into events, never throwing: a malformed or
 * empty file (e.g. from a killed run) yields an empty array.
 */
export const parseEvents = (raw: string): RunEvent[] => {
  if (raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunEvent[]) : [];
  } catch {
    return [];
  }
};

/**
 * Parse an NDJSON event stream - one JSON event per line, the shape our direct
 * agent step tees to `execution.ndjson` from claude's stream-json output. Blank
 * lines and any line that is not a JSON object (e.g. a stray log line on the
 * stream) are skipped, never thrown on, so a partial file from a killed run
 * still yields the events captured before it died.
 */
export const parseEventStream = (raw: string): RunEvent[] => {
  const events: RunEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        events.push(parsed as RunEvent);
      }
    } catch {
      // Not a JSON object on its own line; ignore it.
    }
  }
  return events;
};

export type ParkCommentParams = {
  /** The agent step's outcome: "success", "failure", or anything else. */
  outcome: string;
  /** The agent's final message from extractResult(), or null if none. */
  result: string | null;
  /** Link back to the Actions run for the full transcript and logs. */
  runUrl: string;
};

const PARK_HEADER = "**⚠️ Parked for the captain - no PR opened.**";
/** Cap the quoted explanation so the comment stays well under GitHub's limit. */
const RESULT_MAX = 6000;

const blockquote = (text: string): string =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

/**
 * Compose the parked-ticket comment, choosing the message from what actually
 * happened: the agent stopped on purpose (we quote its own explanation), it
 * finished silently (likely no change needed), or the run failed / timed out.
 * Always ends with a link back to the run.
 */
export const formatParkComment = (params: ParkCommentParams): string => {
  const { outcome, result, runUrl } = params;

  let body: string;
  if (outcome === "success" && result) {
    const trimmed =
      result.length > RESULT_MAX ? `${result.slice(0, RESULT_MAX)}…` : result;
    body =
      "The agent ran but stopped before opening a PR (a risky finding it would not auto-approve, or no change was needed). Its own explanation:\n\n" +
      blockquote(trimmed);
  } else if (outcome === "success") {
    body =
      "The agent finished without opening a PR and left no explanation - most likely it decided no change was needed.";
  } else {
    body =
      "The agent run failed or was cut off before it could open a PR (an error, or it hit the job's 30-minute timeout).";
  }

  return `${PARK_HEADER}\n\n${body}\n\n[View the full run transcript and logs](${runUrl})`;
};
