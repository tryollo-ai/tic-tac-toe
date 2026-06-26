import { getRoom, toView } from "@/lib/roomStore";
import type { RoomView } from "@/lib/roomTypes";

export const dynamic = "force-dynamic";

/**
 * How often the stream re-reads the room and pushes any change. The server does
 * the polling once per connection and only emits when the serialized view
 * actually changes, so clients get near-instant updates over a single
 * connection instead of each polling the room directly.
 */
const POLL_MS = 1000;

/**
 * Comment-only heartbeat cadence. Keeps intermediaries (proxies, load
 * balancers) from closing an otherwise-idle stream, and lets the browser notice
 * a dropped connection so it can reconnect.
 */
const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events stream of a room's live state. Replaces per-client polling
 * of the room GET: the server polls the store on the client's behalf and emits
 * a `room` event whenever the serialized view changes, a `gone` event when the
 * room disappears, and periodic heartbeat comments to keep the pipe open. The
 * optional `playerId` heartbeats that player's seat just like the room GET, so
 * an open stream keeps a seat alive on its own.
 *
 * Clients keep a slow polling fallback for when the stream can't connect (e.g.
 * a proxy that buffers `text/event-stream`), so this is an enhancement, not a
 * hard dependency.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId =
    new URL(request.url).searchParams.get("playerId") ?? undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastPayload: string | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let consecutiveFailures = 0;
      const MAX_CONSECUTIVE_FAILURES = 3;

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      };

      const send = (event: string, data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      // Read the room once and emit only when its meaningful view changed. The
      // `playerId` read heartbeats this player's seat, which rewrites `seatSeen`
      // every tick - a private liveness field the client never renders - so it
      // is excluded from the change key to avoid emitting on every heartbeat. A
      // transient store error is swallowed so one failed read doesn't tear down
      // the stream; the client's polling fallback covers any missed update.
      const tick = async () => {
        if (closed) return;
        let view: RoomView;
        try {
          const room = await getRoom(id, playerId);
          if (closed) return;
          if (!room) {
            send("gone", "{}");
            close();
            return;
          }
          view = toView(room);
          consecutiveFailures = 0;
        } catch {
          if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            close();
          }
          return;
        }
        const { seatSeen: _seatSeen, ...rest } = view;
        const key = JSON.stringify(rest);
        if (key !== lastPayload) {
          lastPayload = key;
          send("room", JSON.stringify(view));
        }
      };

      // Self-rescheduling poll (instead of setInterval) so a slow read can never
      // overlap the next one.
      const scheduleNext = () => {
        if (closed) return;
        pollTimer = setTimeout(async () => {
          await tick();
          scheduleNext();
        }, POLL_MS);
      };

      request.signal.addEventListener("abort", close);

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_MS);

      // Push the current state immediately, then poll for changes.
      void tick().then(scheduleNext);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
