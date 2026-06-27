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

/** The token-accounting block claude attaches to a message / the result event.
 * Field names follow the Anthropic usage shape; every field is optional because
 * a partial or malformed event may carry only some of them. */
export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** Per-model totals claude reports on the final `result` event under
 * `modelUsage` (camelCase, unlike the per-message `usage` above). Optional
 * throughout for the same defensive reason. */
export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUSD?: number;
};

/** One entry in the execution_file array. Only the fields we read are typed. */
export type RunEvent = {
  type?: string;
  subtype?: string;
  /** The final summary text, present on the `result` event. */
  result?: string;
  /** Wall-clock turns claude took; present on the `result` event. */
  num_turns?: number;
  /** Total billed cost in USD; present on the `result` event. */
  total_cost_usd?: number;
  /** Token counts. On the `result` event this is the run total; on an
   * `assistant` event it is that turn's usage. */
  usage?: Usage;
  /** Per-model token + cost totals, present on the `result` event. */
  modelUsage?: Record<string, ModelUsage>;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    /** Per-turn usage also rides on the assistant message itself. */
    usage?: Usage;
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

/** A run's token-and-cost totals, distilled from the events for logging. All
 * counts default to 0 so a partial run still produces a coherent report. */
export type UsageSummary = {
  /** Fresh prompt tokens billed at full input rate. */
  inputTokens: number;
  /** Generated tokens. */
  outputTokens: number;
  /** Tokens written into the prompt cache (billed at the write rate). */
  cacheCreationTokens: number;
  /** Tokens served from the prompt cache (billed at the cheap read rate, but
   * by far the largest count on a long agentic run - re-reading the whole
   * context every turn is where the apparent token volume comes from). */
  cacheReadTokens: number;
  /** Reported total billed cost in USD, or null when the run never reported one. */
  totalCostUsd: number | null;
  /** Turns claude took, or null when not reported. */
  numTurns: number | null;
  /** Per-model breakdown from the result event's `modelUsage`, empty when absent. */
  perModel: Array<{ model: string; usage: ModelUsage }>;
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Every token count a usage block carries, summed - the single number that
 * best captures "how much context moved through the model" on a turn/run. */
export const totalTokens = (usage: Usage | undefined): number =>
  num(usage?.input_tokens) +
  num(usage?.output_tokens) +
  num(usage?.cache_creation_input_tokens) +
  num(usage?.cache_read_input_tokens);

/**
 * Pull a run's token + cost totals from its events. Prefers the final `result`
 * event (claude reports the authoritative run totals there); if the run died
 * before emitting one, falls back to summing the per-turn usage on each
 * assistant event so a timed-out run still yields a meaningful breakdown.
 * Never throws on a partial/malformed stream - missing fields read as 0/null.
 */
export const extractUsage = (events: RunEvent[]): UsageSummary => {
  const result = [...events]
    .reverse()
    .find((event) => event.type === "result");

  if (result) {
    const usage = result.usage ?? {};
    const perModel = Object.entries(result.modelUsage ?? {}).map(
      ([model, usage]) => ({ model, usage }),
    );
    return {
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      totalCostUsd:
        typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
      numTurns: typeof result.num_turns === "number" ? result.num_turns : null,
      perModel,
    };
  }

  // No result event (killed/timed-out run): aggregate the per-turn usage that
  // rides on each assistant message instead, so the report is still useful.
  const summary: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalCostUsd: null,
    numTurns: null,
    perModel: [],
  };
  let turns = 0;
  for (const event of events) {
    if (event.type !== "assistant") continue;
    turns += 1;
    const usage = event.usage ?? event.message?.usage;
    if (!usage) continue;
    summary.inputTokens += num(usage.input_tokens);
    summary.outputTokens += num(usage.output_tokens);
    summary.cacheCreationTokens += num(usage.cache_creation_input_tokens);
    summary.cacheReadTokens += num(usage.cache_read_input_tokens);
  }
  if (turns > 0) summary.numTurns = turns;
  return summary;
};

/** Group US digits with thousands separators without locale surprises. */
const grouped = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Render a run's token usage as a compact markdown table for the job's Summary
 * tab - the per-run telemetry that answers "where is the token cost going?".
 * Leads with the total token volume and cost, then the input/output/cache split
 * (cache reads dominate a long agentic run), then a per-model breakdown when
 * claude reported one. Pure and defensive: an all-zero summary still renders.
 */
export const formatUsageReport = (summary: UsageSummary): string => {
  const total =
    summary.inputTokens +
    summary.outputTokens +
    summary.cacheCreationTokens +
    summary.cacheReadTokens;

  const lines: string[] = [];
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Total tokens | ${grouped(total)} |`);
  lines.push(`| Input (uncached) | ${grouped(summary.inputTokens)} |`);
  lines.push(`| Output | ${grouped(summary.outputTokens)} |`);
  lines.push(`| Cache writes | ${grouped(summary.cacheCreationTokens)} |`);
  lines.push(`| Cache reads | ${grouped(summary.cacheReadTokens)} |`);
  if (summary.numTurns !== null) {
    lines.push(`| Turns | ${grouped(summary.numTurns)} |`);
    if (summary.numTurns > 0) {
      lines.push(`| Avg tokens / turn | ${grouped(total / summary.numTurns)} |`);
    }
  }
  if (summary.totalCostUsd !== null) {
    lines.push(`| Reported cost (USD) | $${summary.totalCostUsd.toFixed(4)} |`);
  }

  let report = lines.join("\n");

  if (summary.perModel.length > 0) {
    const modelLines: string[] = [
      "",
      "Per model:",
      "",
      "| Model | Input | Output | Cache write | Cache read | Cost (USD) |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    ];
    for (const { model, usage } of summary.perModel) {
      const cost =
        typeof usage.costUSD === "number" ? `$${usage.costUSD.toFixed(4)}` : "-";
      modelLines.push(
        `| ${model} | ${grouped(num(usage.inputTokens))} | ` +
          `${grouped(num(usage.outputTokens))} | ` +
          `${grouped(num(usage.cacheCreationInputTokens))} | ` +
          `${grouped(num(usage.cacheReadInputTokens))} | ${cost} |`,
      );
    }
    report += `\n${modelLines.join("\n")}`;
  }

  return report;
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

const PARK_HEADER = "**⚠️ Parked for a maintainer - no PR opened.**";
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
