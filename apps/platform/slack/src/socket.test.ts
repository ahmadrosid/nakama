import { afterEach, expect, test } from "bun:test";
import { connectSlackSocket, type SlackMessageEvent } from "./socket";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("acks envelopes, drops redelivered events, and reconnects on disconnect", async () => {
  const acks: string[] = [];
  let connections = 0;
  const server = Bun.serve({
    fetch: (request, srv) =>
      srv.upgrade(request) ? undefined : new Response("no", { status: 400 }),
    port: 0,
    websocket: {
      message: (_socket, raw) => {
        acks.push(
          (JSON.parse(String(raw)) as { envelope_id: string }).envelope_id
        );
      },
      open: (socket) => {
        connections += 1;
        socket.send(JSON.stringify({ type: "hello" }));
        if (connections > 1) {
          return;
        }
        const envelope = {
          envelope_id: "env-1",
          payload: {
            event: { channel: "D1", text: "hi", ts: "1", type: "message" },
            event_id: "Ev1",
          },
          type: "events_api",
        };
        socket.send(JSON.stringify(envelope));
        socket.send(JSON.stringify({ ...envelope, envelope_id: "env-2" }));
        socket.send(
          JSON.stringify({ reason: "refresh_requested", type: "disconnect" })
        );
      },
    },
  });
  let opens = 0;
  globalThis.fetch = (async () => {
    opens += 1;
    return Response.json({ ok: true, url: `ws://localhost:${server.port}` });
  }) as unknown as typeof fetch;

  const events: SlackMessageEvent[] = [];
  const statuses: boolean[] = [];
  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent: (event) => events.push(event),
    onStatus: (connected) => statuses.push(connected),
  });

  const deadline = Date.now() + 5000;
  while (statuses.length < 3 && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  socket.close();
  server.stop(true);

  expect(acks).toEqual(["env-1", "env-2"]);
  expect(events.map((event) => event.text)).toEqual(["hi"]);
  expect(opens).toBe(2);
  expect(statuses.slice(0, 3)).toEqual([true, false, true]);
});
