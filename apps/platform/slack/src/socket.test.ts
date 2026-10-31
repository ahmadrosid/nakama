import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlackEventHandler, SlackEventInbox } from "./chat-handler";
import { connectSlackSocket, type SlackMessageEvent } from "./socket";

const realFetch = globalThis.fetch;

const inboxPath = () =>
  join(mkdtempSync(join(tmpdir(), "nakama-slack-inbox-")), "event-inbox.json");

const tempInbox = () => new SlackEventInbox(inboxPath());

const dm = (ts: string): SlackMessageEvent => ({
  channel: "D1",
  channel_type: "im",
  text: ts,
  ts,
  type: "message",
});

async function reloaded(path: string): Promise<SlackEventInbox> {
  const inbox = new SlackEventInbox(path);

  await inbox.load();

  return inbox;
}

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
        // SAFETY: The test server sends only serialized ack envelopes here.
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
        // Later, or the socket closes before the first event's ack goes out.
        setTimeout(() => {
          socket.send(
            JSON.stringify({ reason: "refresh_requested", type: "disconnect" })
          );
        }, 50);
      },
    },
  });

  let opens = 0;
  // SAFETY: The mock ignores request arguments and returns a valid fetch response.
  globalThis.fetch = (async () => {
    opens += 1;

    return Response.json({ ok: true, url: `ws://localhost:${server.port}` });
  }) as typeof fetch;

  const events: SlackMessageEvent[] = [];
  const statuses: boolean[] = [];

  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent: (event) => {
      events.push(event);
    },
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

test("a handler that throws produces the error reply in the event thread", async () => {
  const acks: string[] = [];

  const posted: Array<{ channel: string; text: string; threadTs?: string }> =
    [];

  const server = Bun.serve({
    fetch: (request, srv) =>
      srv.upgrade(request) ? undefined : new Response("no", { status: 400 }),
    port: 0,
    websocket: {
      message: (_socket, raw) => {
        // SAFETY: The test server sends only serialized ack envelopes here.
        acks.push(
          (JSON.parse(String(raw)) as { envelope_id: string }).envelope_id
        );
      },
      open: (socket) => {
        socket.send(JSON.stringify({ type: "hello" }));

        const envelope = {
          envelope_id: "env-err-1",
          payload: {
            event: {
              channel: "C_FAIL",
              text: "trigger failure",
              ts: "123.456",
              type: "message",
            },
            event_id: "EvFail1",
          },
          type: "events_api",
        };

        socket.send(JSON.stringify(envelope));
      },
    },
  });

  // SAFETY: The mock ignores request arguments and returns a valid fetch response.
  globalThis.fetch = (async () =>
    Response.json({
      ok: true,
      url: `ws://localhost:${server.port}`,
    })) as typeof fetch;

  const slack = {
    postMessage: async (channel: string, text: string, threadTs?: string) => {
      posted.push({ channel, text, threadTs });
    },
  };

  const { accept: onEvent } = createSlackEventHandler({
    handleEvent: async () => {
      throw new Error("turn execution failed");
    },
    inbox: tempInbox(),
    slack: { ...slack, removeReaction: async () => {} },
    wants: () => true,
  });

  const statuses: boolean[] = [];

  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent,
    onStatus: (connected) => statuses.push(connected),
  });

  const deadline = Date.now() + 5000;

  while ((acks.length === 0 || posted.length === 0) && Date.now() < deadline) {
    await Bun.sleep(20);
  }

  socket.close();
  server.stop(true);

  expect(acks).toEqual(["env-err-1"]);
  expect(posted).toEqual([
    {
      channel: "C_FAIL",
      text: "turn execution failed",
      threadTs: "123.456",
    },
  ]);
});

test("an event Slack was not told about comes back and is accepted then", async () => {
  const acks: string[] = [];
  let release: () => void = () => {};

  const server = Bun.serve({
    fetch: (request, srv) =>
      srv.upgrade(request) ? undefined : new Response("no", { status: 400 }),
    port: 0,
    websocket: {
      message: (_socket, raw) => {
        // SAFETY: The test server sends only serialized ack envelopes here.
        acks.push(
          (JSON.parse(String(raw)) as { envelope_id: string }).envelope_id
        );
      },
      open: (ws) => {
        const send = (envelope_id: string) =>
          ws.send(
            JSON.stringify({
              envelope_id,
              payload: { event: dm("1"), event_id: "Ev1" },
              type: "events_api",
            })
          );

        send("env-1");
        release = () => send("env-2");
      },
    },
  });

  // SAFETY: The mock ignores request arguments and returns a valid fetch response.
  globalThis.fetch = (async () =>
    Response.json({
      ok: true,
      url: `ws://localhost:${server.port}`,
    })) as typeof fetch;

  let calls = 0;
  let finishAccept: () => void = () => {};

  const accepted = new Promise<void>((resolve) => {
    finishAccept = resolve;
  });

  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent: () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("disk full");
      }

      return accepted;
    },
    onStatus: () => {},
  });

  while (calls < 1) {
    await Bun.sleep(5);
  }

  await Bun.sleep(30);
  expect(acks).toEqual([]);

  release();

  while (calls < 2) {
    await Bun.sleep(5);
  }

  // Accepting is still in progress, so this one is not acked yet either.
  await Bun.sleep(30);
  expect(acks).toEqual([]);

  finishAccept();

  while (acks.length < 1) {
    await Bun.sleep(5);
  }

  socket.close();
  server.stop(true);

  expect(acks).toEqual(["env-2"]);
});

test("after a crash, a turn that never started runs and one that started does not", async () => {
  const path = inboxPath();
  const before = await reloaded(path);
  const never = new Promise<void>(() => {});

  const crashed = createSlackEventHandler({
    handleEvent: (event, onTurnStart) =>
      event.ts === "started" ? onTurnStart().then(() => never) : never,
    inbox: before,
    slack: { postMessage: async () => {}, removeReaction: async () => {} },
    wants: () => true,
  });

  await crashed.accept(dm("queued"), "EvQueued");
  await crashed.accept(dm("started"), "EvStarted");

  while (!(await reloaded(path)).list().some(([, e]) => e.started)) {
    await Bun.sleep(5);
  }

  const inbox = await reloaded(path);
  const ran: string[] = [];
  const posted: string[] = [];
  const reactionsCleared: string[] = [];

  const restarted = createSlackEventHandler({
    handleEvent: async (event) => {
      ran.push(event.ts);
    },
    inbox,
    slack: {
      postMessage: async (_channel, text) => {
        posted.push(text);
      },
      removeReaction: async (_channel, timestamp) => {
        reactionsCleared.push(timestamp);
      },
    },
    wants: () => true,
  });

  // Slack redelivers what was stored but never acked; the replay covers it.
  await restarted.accept(dm("queued"), "EvQueued");
  expect(ran).toEqual([]);

  await restarted.recover();

  while ((await reloaded(path)).list().length > 0) {
    await Bun.sleep(5);
  }

  expect(ran).toEqual(["queued"]);
  expect(posted).toHaveLength(1);
  expect(reactionsCleared).toEqual(["started"]);
});

test("a started event stays until its interrupted reply gets through", async () => {
  const path = inboxPath();
  const first = await reloaded(path);

  await first.add("Ev1", dm("1"));
  await first.markStarted("Ev1");

  const failing = createSlackEventHandler({
    handleEvent: async () => {},
    inbox: await reloaded(path),
    slack: {
      postMessage: async () => {
        throw new Error("slack is down");
      },
      removeReaction: async () => {},
    },
    wants: () => true,
  });

  await failing.recover();

  expect((await reloaded(path)).has("Ev1")).toBe(true);
});

/** A fake Socket Mode server; `send` goes to the newest connection. */
function fakeSlack(onOpen: (connection: number) => void) {
  const acks: string[] = [];
  let connections = 0;
  let current: { close: () => void; send: (data: string) => number };

  const server = Bun.serve({
    fetch: (request, srv) =>
      srv.upgrade(request) ? undefined : new Response("no", { status: 400 }),
    port: 0,
    websocket: {
      message: (_socket, raw) => {
        // SAFETY: The test server sends only serialized ack envelopes here.
        acks.push(
          (JSON.parse(String(raw)) as { envelope_id: string }).envelope_id
        );
      },
      open: (ws) => {
        current = ws;
        connections += 1;
        onOpen(connections);
      },
    },
  });

  // SAFETY: The mock ignores request arguments and returns a valid fetch response.
  globalThis.fetch = (async () =>
    Response.json({
      ok: true,
      url: `ws://localhost:${server.port}`,
    })) as typeof fetch;

  return {
    acks,
    close: () => current.close(),
    send: (envelope_id: string) =>
      current.send(
        JSON.stringify({
          envelope_id,
          payload: { event: dm("1"), event_id: "Ev1" },
          type: "events_api",
        })
      ),
    stop: () => server.stop(true),
  };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;

  while (!check() && Date.now() < deadline) {
    await Bun.sleep(5);
  }
}

test("a duplicate is not acked ahead of a first copy that then fails", async () => {
  const slack = fakeSlack(() => {});
  let calls = 0;
  let fail: (error: Error) => void = () => {};

  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent: () => {
      calls += 1;

      return calls === 1
        ? new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
        : Promise.resolve();
    },
    onStatus: () => {},
  });

  await Bun.sleep(100);
  slack.send("env-1");
  await until(() => calls === 1);
  slack.send("env-dup");
  await Bun.sleep(50);
  expect(slack.acks).toEqual([]);

  fail(new Error("disk full"));
  await Bun.sleep(50);
  expect(slack.acks).toEqual([]);

  slack.send("env-retry");
  await until(() => slack.acks.length > 0);

  socket.close();
  slack.stop();

  expect(calls).toBe(2);
  expect(slack.acks).toEqual(["env-retry"]);
});

test("an event accepted across a reconnect runs once and is acked on the new socket", async () => {
  let opened = 0;

  const slack = fakeSlack((connection) => {
    opened = connection;
  });

  let calls = 0;
  let finish: () => void = () => {};

  const socket = connectSlackSocket({
    appToken: "xapp-test",
    onEvent: () => {
      calls += 1;

      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    onStatus: () => {},
  });

  await until(() => opened === 1);
  slack.send("env-old");
  await until(() => calls === 1);
  slack.close();
  await until(() => opened === 2);
  finish();
  await Bun.sleep(30);

  slack.send("env-new");
  await until(() => slack.acks.length > 0);

  socket.close();
  slack.stop();

  expect(calls).toBe(1);
  expect(slack.acks).toEqual(["env-new"]);
});

test("recover reports an old unstarted event instead of running it", async () => {
  const path = inboxPath();
  const first = await reloaded(path);

  await first.add("EvOld", dm(String(Date.now() / 1000 - 2 * 60 * 60)));

  const ran: string[] = [];
  const posted: string[] = [];

  await createSlackEventHandler({
    handleEvent: async (event) => {
      ran.push(event.ts);
    },
    inbox: await reloaded(path),
    slack: {
      postMessage: async (_channel, text) => {
        posted.push(text);
      },
      removeReaction: async () => {},
    },
    wants: () => true,
  }).recover();

  expect(ran).toEqual([]);
  expect(posted).toHaveLength(1);
  expect((await reloaded(path)).list()).toEqual([]);
});

test("an event the bot does not want is neither stored nor run", async () => {
  const path = inboxPath();
  let ran = 0;

  await createSlackEventHandler({
    handleEvent: async () => {
      ran += 1;
    },
    inbox: await reloaded(path),
    slack: { postMessage: async () => {}, removeReaction: async () => {} },
    wants: () => false,
  }).accept(dm("1"), "Ev1");

  expect(ran).toBe(0);
  expect((await reloaded(path)).list()).toEqual([]);
});
