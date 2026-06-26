import { describe, expect, it } from "vitest";
import {
  extractResult,
  formatParkComment,
  formatStreamLines,
  formatTranscript,
  parseEvents,
  parseEventStream,
  type RunEvent,
} from "./agentRunReport";

/** A realistic run: init, assistant text + tool calls, a tool result, result. */
const sampleEvents: RunEvent[] = [
  { type: "system", subtype: "init" },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Reading the ticket." },
        { type: "tool_use", name: "Read", input: { file_path: "ticket.json" } },
        {
          type: "tool_use",
          name: "Bash",
          input: { command: "npm test\nnpm run lint", description: "run checks" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", text: "lots of noisy output" }],
    },
  },
  {
    type: "result",
    subtype: "success",
    result: "Stopped before pushing: the Review stage flagged a regression.",
  },
];

describe("formatTranscript", () => {
  it("renders assistant text and compact tool lines, dropping tool results", () => {
    const out = formatTranscript(sampleEvents);

    expect(out).toContain("**Claude:** Reading the ticket.");
    expect(out).toContain("- `Read`: ticket.json");
    // Multi-line commands collapse to the first line.
    expect(out).toContain("- `Bash`: npm test");
    expect(out).toContain(
      "**Claude (final):** Stopped before pushing: the Review stage flagged a regression.",
    );
    // The noisy tool-result and the system event never appear.
    expect(out).not.toContain("noisy output");
    expect(out).not.toContain("init");
  });

  it("truncates an over-long tool argument", () => {
    const long = "x".repeat(200);
    const out = formatTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: long } }] },
      },
    ]);

    expect(out).toContain("…");
    expect(out.length).toBeLessThan(long.length);
  });

  it("labels a tool call with no recognizable argument by name only", () => {
    const out = formatTranscript([
      { type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite" }] } },
    ]);

    expect(out).toBe("- `TodoWrite`");
  });

  it("returns an empty string when there is nothing to show", () => {
    expect(formatTranscript([])).toBe("");
    expect(formatTranscript([{ type: "system", subtype: "init" }])).toBe("");
  });
});

describe("formatStreamLines", () => {
  it("renders assistant text and compact tool lines as plain text", () => {
    const [textEvent] = [sampleEvents[1]];
    const lines = formatStreamLines(textEvent);

    expect(lines).toContain("Claude: Reading the ticket.");
    expect(lines).toContain("  -> Read: ticket.json");
    // Multi-line commands collapse to the first line.
    expect(lines).toContain("  -> Bash: npm test");
    // No markdown styling and no token/cost noise leak through.
    expect(lines.join("\n")).not.toContain("**");
  });

  it("renders the final result without usage/cost fields", () => {
    const lines = formatStreamLines({
      type: "result",
      subtype: "success",
      result: "Opened the PR.",
      // Extra fields like total_cost_usd / usage are simply not read.
    } as RunEvent);

    expect(lines).toEqual(["Claude (final): Opened the PR."]);
  });

  it("labels an argument-less tool call by name only", () => {
    expect(
      formatStreamLines({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "TodoWrite" }] },
      }),
    ).toEqual(["  -> TodoWrite"]);
  });

  it("produces no lines for system or tool-result events", () => {
    expect(formatStreamLines({ type: "system", subtype: "init" })).toEqual([]);
    expect(
      formatStreamLines({
        type: "user",
        message: { content: [{ type: "tool_result", text: "noisy output" }] },
      }),
    ).toEqual([]);
  });
});

describe("parseEventStream", () => {
  it("parses one JSON event per line, skipping blanks and non-objects", () => {
    const raw = [
      JSON.stringify({ type: "system", subtype: "init" }),
      "",
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      "[1,2,3]", // a JSON array on a line is not an event; skip it
      "not json at all", // a stray log line; skip it
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
    ].join("\n");

    const events = parseEventStream(raw);
    expect(events.map((e) => e.type)).toEqual(["system", "assistant", "result"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseEventStream("")).toEqual([]);
    expect(parseEventStream("\n\n")).toEqual([]);
  });
});

describe("extractResult", () => {
  it("returns the result event's text", () => {
    expect(extractResult(sampleEvents)).toBe(
      "Stopped before pushing: the Review stage flagged a regression.",
    );
  });

  it("prefers the result event over earlier assistant text", () => {
    const events: RunEvent[] = [
      { type: "assistant", message: { content: [{ type: "text", text: "interim note" }] } },
      { type: "result", subtype: "success", result: "final word" },
    ];
    expect(extractResult(events)).toBe("final word");
  });

  it("falls back to the last assistant text when there is no result event", () => {
    const events: RunEvent[] = [
      { type: "assistant", message: { content: [{ type: "text", text: "first" }] } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "why I stopped" },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
    ];
    expect(extractResult(events)).toBe("why I stopped");
  });

  it("returns null when neither a result nor assistant text is present", () => {
    expect(extractResult([{ type: "system", subtype: "init" }])).toBeNull();
    expect(extractResult([])).toBeNull();
  });
});

describe("formatParkComment", () => {
  const runUrl = "https://github.com/puopg/tic-tac-toe/actions/runs/123";

  it("quotes the agent's explanation when it stopped on a successful run", () => {
    const out = formatParkComment({
      outcome: "success",
      result: "Stopped: the Review stage flagged a regression.",
      runUrl,
    });

    expect(out).toContain("Parked for the captain");
    expect(out).toContain("> Stopped: the Review stage flagged a regression.");
    expect(out).toContain(`(${runUrl})`);
  });

  it("uses a failure message when the run failed or timed out", () => {
    const out = formatParkComment({ outcome: "failure", result: null, runUrl });

    expect(out).toMatch(/failed or was cut off/);
    expect(out).toContain(runUrl);
  });

  it("uses a no-explanation message when a successful run left no result", () => {
    const out = formatParkComment({ outcome: "success", result: null, runUrl });

    expect(out).toMatch(/left no explanation/);
  });

  it("treats a failed run as a failure even if some text was captured", () => {
    const out = formatParkComment({
      outcome: "failure",
      result: "partial work before the crash",
      runUrl,
    });

    expect(out).toMatch(/failed or was cut off/);
    expect(out).not.toContain("partial work");
  });

  it("truncates an over-long explanation", () => {
    const long = "y".repeat(7000);
    const out = formatParkComment({ outcome: "success", result: long, runUrl });

    expect(out).toContain("…");
    expect(out.length).toBeLessThan(long.length + 500);
  });
});

describe("parseEvents", () => {
  it("parses a JSON array of events", () => {
    expect(parseEvents(JSON.stringify(sampleEvents))).toHaveLength(sampleEvents.length);
  });

  it("returns an empty array for empty, malformed, or non-array input", () => {
    expect(parseEvents("")).toEqual([]);
    expect(parseEvents("   ")).toEqual([]);
    expect(parseEvents("{not json")).toEqual([]);
    expect(parseEvents('{"type":"result"}')).toEqual([]);
  });
});
