import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import type { RoomView } from "@/lib/roomTypes";
import type { Board } from "@/utils/gameLogic";

vi.mock("@/lib/roomStore", () => ({
  getRoom: vi.fn(),
  toView: vi.fn((r: unknown) => r),
}));

import { getRoom, toView } from "@/lib/roomStore";
const mockGetRoom = vi.mocked(getRoom);
const mockToView = vi.mocked(toView);

const EMPTY_BOARD: Board = [
  null, null, null, null, null, null, null, null, null,
];

function makeView(overrides: Partial<RoomView> = {}): RoomView {
  return {
    id: "r1",
    name: "Test Room",
    board: EMPTY_BOARD,
    actions: [],
    xIsNext: true,
    scores: { X: 0, O: 0, draws: 0 },
    seats: { X: "px", O: null },
    mode: "two-player",
    oShiftUsed: false,
    seatSeen: { X: 1000, O: null },
    createdAt: 1000,
    lastActivity: 1000,
    status: "waiting",
    winningLine: null,
    ...overrides,
  };
}

function makeRequest(
  id: string,
  playerId?: string,
): [Request, AbortController] {
  const ac = new AbortController();
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  return [
    new Request(`http://localhost/api/rooms/${id}/stream${qs}`, {
      signal: ac.signal,
    }),
    ac,
  ];
}

/** Read all buffered chunks until the stream closes, parsing SSE events. */
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Array<{ type: string; data: string }>> {
  const events: Array<{ type: string; data: string }> = [];
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      if (block.startsWith(":")) continue; // SSE comment (heartbeat ping)
      const typeMatch = block.match(/^event: (\w+)/m);
      const dataMatch = block.match(/^data: (.+)/m);
      if (typeMatch) {
        events.push({ type: typeMatch[1], data: dataMatch?.[1] ?? "" });
      }
    }
  }
  return events;
}

describe("GET /api/rooms/[id]/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns SSE response headers", async () => {
    mockGetRoom.mockResolvedValue(makeView());
    mockToView.mockReturnValue(makeView());

    const [req, ac] = makeRequest("r1", "px");
    const res = await GET(req, { params: Promise.resolve({ id: "r1" }) });

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    ac.abort();
  });

  it("pushes the initial room state immediately on open", async () => {
    const view = makeView();
    mockGetRoom.mockResolvedValue(view);
    mockToView.mockReturnValue(view);

    const [req, ac] = makeRequest("r1", "px");
    const res = await GET(req, { params: Promise.resolve({ id: "r1" }) });
    const reader = res.body!.getReader();

    // Advance past the initial microtask chain (getRoom mock resolves in one
    // microtask; advancing a small window flushes it without triggering the
    // 1000ms poll timer).
    await vi.advanceTimersByTimeAsync(100);

    // Close before the next poll fires so drain can terminate.
    ac.abort();
    await vi.runAllTimersAsync();

    const events = await drain(reader);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("room");
    expect(JSON.parse(events[0].data).id).toBe("r1");
  });

  it("does not emit when only seatSeen changes (heartbeat exclusion)", async () => {
    const v1 = makeView({ seatSeen: { X: 1000, O: null } });
    // v2: only seatSeen differs — must not produce a new event
    const v2 = makeView({ seatSeen: { X: 2000, O: null } });
    // v3: board changes too — must produce a new event
    const v3 = makeView({
      board: ["X", null, null, null, null, null, null, null, null] as Board,
      seatSeen: { X: 3000, O: null },
    });

    mockGetRoom
      .mockResolvedValueOnce(v1) // initial tick
      .mockResolvedValueOnce(v2) // tick 2 – seatSeen-only, no event
      .mockResolvedValueOnce(v3) // tick 3 – board changed, event
      .mockImplementation(() => new Promise(() => {})); // hang after 3 calls
    mockToView.mockImplementation((r) => r as RoomView);

    const [req, ac] = makeRequest("r1", "px");
    const res = await GET(req, { params: Promise.resolve({ id: "r1" }) });
    const reader = res.body!.getReader();

    // Flush initial tick (microtask) + advance past the 1000ms and 2000ms poll
    // timers so all 3 ticks run.
    await vi.advanceTimersByTimeAsync(2500);

    ac.abort();
    await vi.runAllTimersAsync();

    const events = await drain(reader);
    // Exactly 2 "room" events: initial state (v1) and the board change (v3).
    // The seatSeen-only change (v2) must not generate a third event.
    expect(events.filter((e) => e.type === "room")).toHaveLength(2);
    expect(mockGetRoom).toHaveBeenCalledTimes(3);
  });

  it("emits gone and closes when the room disappears", async () => {
    const view = makeView();
    mockGetRoom
      .mockResolvedValueOnce(view) // initial tick
      .mockResolvedValueOnce(null); // tick 2 – room deleted
    mockToView.mockReturnValue(view);

    const [req, ac] = makeRequest("r1", "px");
    const res = await GET(req, { params: Promise.resolve({ id: "r1" }) });
    const reader = res.body!.getReader();

    // Initial tick + the 1000ms timer-driven tick where the room is gone.
    await vi.advanceTimersByTimeAsync(1100);

    // The route closes the stream itself after sending "gone"; drain reads the
    // buffered events and terminates on the natural stream end.
    const events = await drain(reader);
    expect(events.some((e) => e.type === "gone")).toBe(true);

    ac.abort(); // no-op if already closed
  });

  it("closes the stream after 3 consecutive store failures", async () => {
    mockGetRoom.mockRejectedValue(new Error("store error"));
    mockToView.mockReturnValue(makeView());

    const [req, ac] = makeRequest("r1", "px");
    const res = await GET(req, { params: Promise.resolve({ id: "r1" }) });
    const reader = res.body!.getReader();

    // 3 ticks: initial + two timer-driven ticks.
    await vi.advanceTimersByTimeAsync(3000);

    // Stream closed by the route after 3 consecutive failures.
    const events = await drain(reader);
    expect(events).toHaveLength(0); // no room events emitted
    expect(mockGetRoom).toHaveBeenCalledTimes(3);

    ac.abort();
  });
});
