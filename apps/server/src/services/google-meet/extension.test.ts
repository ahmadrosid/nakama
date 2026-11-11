import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { z } from "zod";

interface StorageChanges {
  meetKey?: { newValue?: string };
}

interface ExtensionRequest {
  authorization?: string;
  body?: string;
  method: string;
  path: string;
}

interface StoreData {
  captureSession?: {
    captureUrl: string;
    error?: string;
    meetingId: string;
    origin: string;
    status: string;
    tabId: number;
  };
  meetKey?: string;
  nakamaOrigin?: string;
  pairError?: string;
  pairing?: { code: string };
}

interface MessageInput {
  after?: number;
  caption?: { speakerName: string; text: string };
  origin?: string;
}

const ORIGIN = "https://nakama.example";

const MEET_URL = "https://meet.google.com/abc-defg-hij?authuser=0";

function extensionFile(file: string) {
  return readFileSync(
    new URL(
      `../../../../web/public/google-meet-extension/${file}`,
      import.meta.url
    ),
    "utf8"
  );
}

function fakeStore(data: StoreData) {
  return {
    async get(keys: keyof StoreData | (keyof StoreData)[]) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]])
      );
    },
    async remove(keys: keyof StoreData | (keyof StoreData)[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
    async set(value: StoreData) {
      Object.assign(data, value);
    },
  };
}

function extension(server: { captureProtocol?: number } = {}) {
  const listeners: Array<
    (message: any, sender: any, reply: any) => boolean | void
  > = [];

  const local: StoreData = {};
  const session: StoreData = {};
  const requests: ExtensionRequest[] = [];
  const order: string[] = [];
  const runtimeMessages: any[] = [];
  const openedTabs: string[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();

  const tabs = new Map([
    [1, { id: 1, url: `${ORIGIN}/google-meet` }],
    [2, { id: 2, url: MEET_URL }],
  ]);

  let active = 2;
  let failCapture = false;
  let granted = true;
  let pairStatus: "approved" | "gone" | "pending" = "pending";
  let errorStatus = 0;
  let badge = "";
  const panelBehavior: { openPanelOnActionClick: boolean }[] = [];
  let now = 1_000_000;
  let timerId = 0;

  async function fetch(url: string, init: RequestInit = {}) {
    const target = new URL(url);
    const method = init.method ?? "GET";
    // SAFETY: background.js always sends headers as a plain object.
    const headers = (init.headers ?? {}) as Record<string, string>;

    requests.push({
      authorization: headers.Authorization,
      body: init.body ? String(init.body) : undefined,
      method,
      path: target.pathname + target.search,
    });
    order.push(`${method} ${target.pathname}`);

    if (headers.Authorization && errorStatus) {
      return Response.json({ error: "Refused" }, { status: errorStatus });
    }

    if (target.pathname === "/v1/meet/extension/pair") {
      return Response.json({ code: "K7Q-4M2", expiresIn: 300, pairId: "p1" });
    }

    if (target.pathname === "/v1/meet/extension/pair/p1") {
      return pairStatus === "gone"
        ? Response.json({ error: "Not found" }, { status: 404 })
        : Response.json(
            pairStatus === "approved"
              ? { key: "nmk_test", status: "approved" }
              : { status: "pending" }
          );
    }

    if (target.pathname === "/v1/meet/extension/status") {
      return Response.json({
        captureProtocol: server.captureProtocol ?? 3,
        configured: true,
      });
    }

    if (target.pathname === "/v1/meet/extension/start") {
      return Response.json({
        captureUrl: "wss://nakama.example/v1/meet/capture",
        meetingId: "meeting",
        ticket: "ticket",
      });
    }

    if (target.pathname === "/v1/meet/extension/transcript") {
      return Response.json({
        meeting: { id: "meeting", state: "recording" },
        nextCursor: 0,
        segments: [],
      });
    }

    return Response.json({ ok: true });
  }

  const chrome = {
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText({ text }: { text: string }) {
        badge = text;
      },
    },
    offscreen: { async createDocument() {} },
    permissions: {
      async contains() {
        return granted;
      },
    },
    runtime: {
      async getContexts() {
        return [];
      },
      getURL: (file: string) => `chrome-extension://test-extension/${file}`,
      id: "test-extension",
      onMessage: {
        addListener(
          fn: (message: any, sender: any, reply: any) => boolean | void
        ) {
          listeners.push(fn);
        },
      },
      async sendMessage(message: any) {
        runtimeMessages.push(message);

        if (message.type === "START_CAPTURE") {
          expect(message.captureUrl).toBe(session.captureSession?.captureUrl);
        }

        return failCapture
          ? { error: "Capture denied", needsMicrophone: true }
          : { ok: true };
      },
    },
    sidePanel: {
      async setPanelBehavior(behavior: { openPanelOnActionClick: boolean }) {
        panelBehavior.push(behavior);
      },
    },
    storage: { local: fakeStore(local), session: fakeStore(session) },
    tabCapture: {
      async getMediaStreamId() {
        order.push("getMediaStreamId");

        return "stream";
      },
    },
    tabs: {
      async create({ url }: { url: string }) {
        openedTabs.push(url);
      },
      onRemoved: { addListener() {} },
      async query() {
        return [tabs.get(active)];
      },
      async sendMessage() {},
    },
  };

  runInNewContext(extensionFile("background.js"), {
    AbortSignal,
    chrome,
    clearTimeout(id: number) {
      timers.delete(id);
    },
    console: { warn() {} },
    Date: { now: () => now },
    fetch,
    setTimeout(run: () => void, ms: number) {
      timers.set(++timerId, { at: now + ms, run });

      return timerId;
    },
    URL,
    URLSearchParams,
  });

  const sender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL("sidepanel.html"),
  };

  return {
    activate(id: number) {
      active = id;
    },
    /** Moves the fake clock and runs due timers, one at a time. */
    async advance(ms: number) {
      const until = now + ms;

      for (;;) {
        const [id, next] =
          [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];

        if (!next || next.at > until) {
          break;
        }

        timers.delete(id!);
        now = next.at;
        next.run();
        await Bun.sleep(1);
      }

      now = until;
    },
    badge: () => badge,
    async captureEvent(type: string) {
      listeners[1]!(
        { type },
        { ...sender, url: chrome.runtime.getURL("offscreen.html") },
        () => undefined
      );
      await Bun.sleep(1);
    },
    connected() {
      local.meetKey = "nmk_test";
      local.nakamaOrigin = ORIGIN;
    },
    dispatch(type: string, input: MessageInput = {}) {
      return new Promise<any>((resolve) =>
        listeners[0]!({ ...input, type }, sender, resolve)
      );
    },
    failCapture(value = true) {
      failCapture = value;
    },
    fromPage(type: string, tabId = 1, input: MessageInput = {}) {
      return new Promise<any>((resolve) => {
        const handled = listeners[0]!(
          { ...input, type },
          { ...sender, tab: tabs.get(tabId), url: tabs.get(tabId)!.url },
          resolve
        );

        if (handled !== true) {
          resolve(undefined);
        }
      });
    },
    grant(value: boolean) {
      granted = value;
    },
    listen(
      message: { type: string },
      from: { id: string; url: string },
      reply: (value: { error?: string } | undefined) => void
    ) {
      return listeners[0]!(message, from, reply);
    },
    local,
    openedTabs,
    order,
    pair(value: typeof pairStatus) {
      pairStatus = value;
    },
    panelBehavior,
    requests,
    respondWith(status: number) {
      errorStatus = status;
    },
    runtimeMessages,
    session,
  };
}

test("pairing stores the key only after approval, then stops polling", async () => {
  const ext = extension();
  expect(await ext.dispatch("CONNECT", { origin: "nakama.example/" })).toEqual({
    code: "K7Q-4M2",
  });
  expect(ext.openedTabs).toEqual([`${ORIGIN}/google-meet?pair=K7Q-4M2`]);
  expect(ext.local).toEqual({ nakamaOrigin: ORIGIN });
  expect((await ext.dispatch("STATE")).pairing).toEqual({ code: "K7Q-4M2" });
  await ext.advance(2000);
  expect(ext.requests.at(-1)?.path).toBe("/v1/meet/extension/pair/p1");
  expect(ext.local.meetKey).toBeUndefined();
  ext.pair("approved");
  await ext.advance(2000);
  expect(ext.local).toEqual({ meetKey: "nmk_test", nakamaOrigin: ORIGIN });
  expect(ext.session.pairing).toBeUndefined();
  const count = ext.requests.length;
  await ext.advance(60_000);
  expect(ext.requests).toHaveLength(count);
  expect(ext.requests.every((request) => !request.authorization)).toBe(true);
  expect(await ext.dispatch("STATE")).toMatchObject({
    connected: true,
    origin: ORIGIN,
  });
});

test("pairing gives up after 5 minutes and needs site access first", async () => {
  const ext = extension();
  ext.grant(false);
  expect(
    (await ext.dispatch("CONNECT", { origin: ORIGIN })).error
  ).toBeDefined();
  expect(ext.requests).toHaveLength(0);
  ext.grant(true);
  await ext.dispatch("CONNECT", { origin: ORIGIN });
  await ext.advance(5 * 60 * 1000);

  const polls = ext.requests.filter((request) =>
    request.path.startsWith("/v1/meet/extension/pair/")
  ).length;

  expect(polls).toBeGreaterThan(100);
  expect(polls).toBeLessThanOrEqual(150);
  await ext.advance(10 * 60 * 1000);
  expect(
    ext.requests.filter((request) =>
      request.path.startsWith("/v1/meet/extension/pair/")
    )
  ).toHaveLength(polls);
  expect(ext.local.meetKey).toBeUndefined();
  expect(await ext.dispatch("STATE")).toMatchObject({
    connected: false,
    pairError: expect.any(String),
    pairing: undefined,
  });
});

test("pairing stops when Nakama forgets the code", async () => {
  const ext = extension();
  await ext.dispatch("CONNECT", { origin: ORIGIN });
  ext.pair("gone");
  await ext.advance(2000);
  const count = ext.requests.length;
  await ext.advance(60_000);
  expect(ext.requests).toHaveLength(count);
  expect(ext.session.pairing).toBeUndefined();
  expect(ext.session.pairError).toBeDefined();
});

test("start captures the tab first, then calls Nakama with the key", async () => {
  const ext = extension();
  ext.connected();
  expect(await ext.dispatch("START")).toEqual({ ok: true });
  expect(ext.order).toEqual([
    "getMediaStreamId",
    "GET /v1/meet/extension/status",
    "POST /v1/meet/extension/start",
  ]);
  expect(
    ext.requests.every((request) => request.authorization === "Bearer nmk_test")
  ).toBe(true);
  expect(JSON.parse(ext.requests[1]!.body!)).toEqual({
    url: "https://meet.google.com/abc-defg-hij",
  });
  expect(ext.runtimeMessages.at(-1)).toEqual({
    captureUrl: "wss://nakama.example/v1/meet/capture",
    meetingId: "meeting",
    streamId: "stream",
    ticket: "ticket",
    type: "START_CAPTURE",
  });
  expect(ext.session.captureSession).toMatchObject({
    meetingId: "meeting",
    origin: ORIGIN,
    tabId: 2,
  });
  expect(JSON.stringify(ext.session)).not.toContain("ticket");
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(
    ext.requests.filter((request) => request.path.endsWith("/start"))
  ).toHaveLength(1);
  expect(await ext.fromPage("START")).toBeUndefined();
  expect(await ext.fromPage("CONNECT", 1, { origin: ORIGIN })).toBeUndefined();
  await ext.captureEvent("CAPTURE_STARTED");
  expect(ext.session.captureSession?.status).toBe("recording");
  expect(ext.badge()).toBe("REC");
  await ext.captureEvent("CAPTURE_STOPPED");
  expect(ext.session.captureSession?.status).toBe("stopped");
  expect(ext.requests.at(-1)).toMatchObject({
    authorization: "Bearer nmk_test",
    body: JSON.stringify({ meetingId: "meeting" }),
    path: "/v1/meet/extension/leave",
  });
});

test("start refuses a Nakama that does not speak capture protocol 3", async () => {
  const ext = extension({ captureProtocol: 2 });
  ext.connected();
  expect((await ext.dispatch("START")).error).toBe("Update Nakama first.");
  expect(ext.order).toEqual([
    "getMediaStreamId",
    "GET /v1/meet/extension/status",
  ]);
  expect(ext.session.captureSession).toBeUndefined();
});

test("a 401 clears the key and a 503 keeps it", async () => {
  const ext = extension();
  ext.connected();
  ext.respondWith(503);
  expect((await ext.dispatch("START")).error).toBe("Refused");
  expect(ext.local.meetKey).toBe("nmk_test");
  ext.respondWith(401);
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.local.meetKey).toBeUndefined();
  expect((await ext.dispatch("STATE")).connected).toBe(false);
  const count = ext.requests.length;
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.requests).toHaveLength(count);
});

test("start needs a key and leaves the meeting when capture fails", async () => {
  const ext = extension();
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.order).toHaveLength(0);
  ext.connected();
  ext.failCapture();
  expect((await ext.dispatch("START")).error).toBe("Capture denied");
  expect(ext.requests.at(-1)?.path).toBe("/v1/meet/extension/leave");
  expect(ext.openedTabs).toEqual([
    "chrome-extension://test-extension/microphone.html",
  ]);
  expect((await ext.dispatch("STATE")).captureSession).toMatchObject({
    error: "Capture denied",
    status: "error",
  });
  expect(ext.badge()).toBe("!");
  ext.failCapture(false);
  expect(await ext.dispatch("START")).toEqual({ ok: true });
  await ext.captureEvent("CAPTURE_STARTED");
  expect((await ext.dispatch("STATE")).captureSession.error).toBeUndefined();
  expect((await ext.dispatch("DISCONNECT")).error).toBeDefined();
  expect(ext.local.meetKey).toBe("nmk_test");
});

test("disconnect deletes the key and an open pairing", async () => {
  const ext = extension();
  await ext.dispatch("CONNECT", { origin: ORIGIN });
  expect(await ext.dispatch("DISCONNECT")).toEqual({ ok: true });
  const count = ext.requests.length;
  await ext.advance(60_000);
  expect(ext.requests).toHaveLength(count);
  ext.connected();
  await ext.dispatch("DISCONNECT");
  expect(ext.local.meetKey).toBeUndefined();
  expect((await ext.dispatch("STATE")).connected).toBe(false);
});

test("the Meet tab can read only its recording state, not the transcript or captions", async () => {
  const ext = extension();
  ext.connected();
  await ext.dispatch("START");
  await ext.captureEvent("CAPTURE_STARTED");
  const count = ext.requests.length;
  expect(
    await ext.fromPage("MEET_CAPTION", 2, {
      caption: { speakerName: "A", text: "hello" },
    })
  ).toBeUndefined();
  expect(
    await ext.fromPage("MEET_TRANSCRIPT", 2, { after: 0 })
  ).toBeUndefined();
  await Bun.sleep(1);
  expect(ext.requests).toHaveLength(count);
  expect(await ext.fromPage("MEET_STATE", 2)).toEqual({
    meetingId: "meeting",
    status: "recording",
  });
  expect(await ext.fromPage("MEET_STATE", 1)).toBeNull();
});

test("audio worklet encodes every mono sample as PCM16 and tolerates empty input", () => {
  const messages: (number[] | string)[] = [];
  let Processor: any;
  runInNewContext(
    readFileSync(
      new URL(
        "../../../../web/public/google-meet-extension/audio-worklet.js",
        import.meta.url
      ),
      "utf8"
    ),
    {
      AudioWorkletProcessor: class {
        port = {
          postMessage(buffer: ArrayBuffer | "flushed") {
            messages.push(
              buffer === "flushed" ? buffer : Array.from(new Int16Array(buffer))
            );
          },
        };
      },
      registerProcessor(_name: string, implementation: any) {
        Processor = implementation;
      },
    }
  );
  const processor = new Processor();
  expect(processor.process([])).toBe(true);
  expect(messages).toHaveLength(0);
  expect(
    processor.process([[new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2])]])
  ).toBe(true);
  expect(messages[0]).toEqual([
    -32_768, -32_768, -16_384, 0, 16_383, 32_767, 32_767,
  ]);
  processor.process([[new Float32Array([0.25])]]);
  expect(messages[1]).toEqual([8191]);
  processor.port.onmessage({ data: "flush" });
  expect(messages.at(-1)).toBe("flushed");
  expect(processor.process([[new Float32Array([1])]])).toBe(false);
  expect(messages).toHaveLength(3);
});

test("content script on a Meet call shows only the recording badge", async () => {
  const windowListeners: string[] = [];
  const sent: string[] = [];
  const created: { style: { display?: string } }[] = [];

  const element = () => {
    const node = { append() {}, style: {} };
    created.push(node);

    return node;
  };

  runInNewContext(extensionFile("content.js"), {
    chrome: {
      runtime: {
        id: "extension",
        onMessage: { addListener() {} },
        async sendMessage(message: { type: string }) {
          sent.push(message.type);

          return { status: "recording" };
        },
      },
    },
    document: {
      createElement: element,
      documentElement: { append() {} },
      querySelector: () => null,
    },
    location: {
      hostname: "meet.google.com",
      origin: "https://meet.google.com",
      pathname: "/abc-defg-hij",
    },
    window: {
      addEventListener(name: string) {
        windowListeners.push(name);
      },
    },
  });
  await Bun.sleep(1);
  expect(windowListeners).not.toContain("message");
  expect(sent).toEqual(["MEET_STATE"]);
  expect(created).toHaveLength(1);
  expect(created[0]?.style.display).toBe("block");
});

test("the toolbar button opens the side panel and there is no popup", async () => {
  const ext = extension();
  await Bun.sleep(1);
  expect(ext.panelBehavior).toEqual([{ openPanelOnActionClick: true }]);
  const manifest = JSON.parse(extensionFile("manifest.json"));
  expect(manifest.action.default_popup).toBeUndefined();
  expect(manifest.side_panel).toEqual({ default_path: "sidepanel.html" });

  const fromOldPopup = await new Promise<{ error?: string } | undefined>(
    (resolve) => {
      const handled = ext.listen(
        { type: "STATE" },
        {
          id: "test-extension",
          url: "chrome-extension://test-extension/popup.html",
        },
        resolve
      );

      if (handled !== true) {
        resolve(undefined);
      }
    }
  );

  expect(fromOldPopup).toBeUndefined();
});

test("side panel shows setup progress and only the available capture action", async () => {
  for (const [connected, onMeet, recording] of [
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [true, true, true],
  ]) {
    const elements = new Map<string, any>();

    const element = (selector: string) => {
      if (!elements.has(selector)) {
        elements.set(selector, { dataset: {} });
      }

      return elements.get(selector);
    };

    await runInNewContext(
      readFileSync(
        new URL(
          "../../../../web/public/google-meet-extension/sidepanel.js",
          import.meta.url
        ),
        "utf8"
      ),
      {
        chrome: {
          runtime: {
            async sendMessage() {
              return {
                captureSession: recording ? { status: "recording" } : undefined,
                connected,
              };
            },
          },
          storage: { onChanged: { addListener() {} } },
          tabs: {
            onActivated: { addListener() {} },
            onUpdated: { addListener() {} },
            async query() {
              return [
                {
                  url: onMeet
                    ? "https://meet.google.com/abc-defg-hij"
                    : "https://nakama.example/google-meet",
                },
              ];
            },
          },
        },
        clearInterval() {},
        document: { querySelector: element },
        setInterval: () => 1,
        URL,
        window: { addEventListener() {} },
      }
    );
    await Bun.sleep(0);
    expect(element("#connect-form").hidden).toBe(connected || recording);
    expect(element("#disconnect").hidden).toBe(!connected || recording);
    expect(element("#start").hidden).toBe(!(connected && onMeet) || recording);
    expect(element("#stop").hidden).toBe(!recording);
    expect(element("#connection").dataset.connected).toBe(String(connected));
    expect(element("#connect-step").dataset.done).toBe(String(connected));
    expect(element("#meet-step").dataset.done).toBe(
      String(onMeet || recording)
    );
  }
});

test.each([false, true])(
  "offscreen capture handles microphone denied=%s",
  async (denied) => {
    let listener: any;
    let socket: any;
    let processor: any;
    let stopped = 0;
    const events: string[] = [];
    const frames: (string | Uint8Array | ArrayBuffer)[] = [];

    const track = {
      stop() {
        stopped++;
      },
    };

    const captureUrl = "wss://nakama.example/v1/meet/capture";
    runInNewContext(
      readFileSync(
        new URL(
          "../../../../web/public/google-meet-extension/offscreen.js",
          import.meta.url
        ),
        "utf8"
      ),
      {
        AudioContext: class {
          destination = {};
          audioWorklet = { async addModule() {} };
          createGain() {
            return { connect() {} };
          }
          createMediaStreamSource() {
            return { connect() {} };
          }
          async resume() {}
          async close() {}
        },
        AudioWorkletNode: class {
          port = {
            onmessage: (_event: { data: string }) => {},
            postMessage: () =>
              queueMicrotask(() => this.port.onmessage({ data: "flushed" })),
          };
          constructor() {
            processor = this;
          }
          connect() {}
        },
        chrome: {
          runtime: {
            getURL: (file: string) => `chrome-extension://test/${file}`,
            id: "test",
            onMessage: {
              addListener(fn: any) {
                listener = fn;
              },
            },
            async sendMessage(message: any) {
              events.push(message.type);
            },
          },
        },
        clearTimeout,
        navigator: {
          mediaDevices: {
            async getUserMedia(options: any) {
              if (denied && options.audio.echoCancellation) {
                throw new Error("Permission denied");
              }

              return {
                getAudioTracks: () => [track],
                getTracks: () => [track],
              };
            },
          },
        },
        setTimeout,
        WebSocket: class {
          static OPEN = 1;
          readyState = 1;
          onopen?: () => void;
          constructor(public url: string) {
            socket = this;
            queueMicrotask(() => this.onopen?.());
          }
          send(frame: string | Uint8Array | ArrayBuffer) {
            frames.push(frame);

            const text = z.string().safeParse(frame);

            if (!text.success) {
              return;
            }

            const type = z
              .object({ type: z.string() })
              .parse(JSON.parse(text.data)).type;

            if (type === "auth") {
              // Audio produced before "ready" must not reach the server.
              setTimeout(() => {
                processor.port.onmessage({ data: new ArrayBuffer(8) });
                socket.onmessage({ data: JSON.stringify({ type: "ready" }) });
              }, 5);
            } else {
              queueMicrotask(() =>
                socket.onmessage({
                  data: JSON.stringify({ type: "capture-finalized" }),
                })
              );
            }
          }
          close() {
            this.readyState = 3;
          }
        },
      }
    );
    const sender = { id: "test" };

    const result = await new Promise((resolve) =>
      listener(
        {
          captureUrl,
          meetingId: "meeting",
          streamId: "stream",
          ticket: "ticket",
          type: "START_CAPTURE",
        },
        sender,
        resolve
      )
    );

    if (denied) {
      expect(result).toMatchObject({ needsMicrophone: true });
      expect(events).toEqual(["CAPTURE_ERROR"]);
      expect(socket).toBeUndefined();
      expect(stopped).toBe(1);

      return;
    }

    expect(result).toEqual({ ok: true });
    expect(socket.url).toBe(captureUrl);
    const frame = new ArrayBuffer(256);
    processor.port.onmessage({ data: frame });
    expect(frames).toEqual([
      JSON.stringify({ meetingId: "meeting", ticket: "ticket", type: "auth" }),
      frame,
    ]);
    expect(events).toEqual(["CAPTURE_STARTED"]);
    expect(stopped).toBe(0);
    await new Promise((resolve) =>
      listener({ type: "STOP_CAPTURE" }, sender, resolve)
    );
    expect(events).toEqual(["CAPTURE_STARTED", "CAPTURE_STOPPED"]);
    expect(frames.at(-1)).toBe(JSON.stringify({ protocol: 3, type: "stop" }));
    expect(stopped).toBeGreaterThanOrEqual(2);
  }
);

test("side panel transcript access is bound to its captured meeting and unavailable to pages", async () => {
  const ext = extension();
  ext.connected();
  await ext.dispatch("START");
  await ext.dispatch("TRANSCRIPT");
  expect(ext.requests.at(-1)?.path).toBe(
    "/v1/meet/extension/transcript?after=0&meetingId=meeting"
  );
  expect(await ext.fromPage("TRANSCRIPT")).toBeUndefined();
  await ext.captureEvent("CAPTURE_STOPPED");
  await ext.dispatch("TRANSCRIPT");
  expect(ext.requests.at(-1)?.path).toStartWith(
    "/v1/meet/extension/transcript"
  );
  ext.local.nakamaOrigin = "https://other.example";
  const count = ext.requests.length;
  expect(await ext.dispatch("TRANSCRIPT")).toBeNull();
  expect(ext.requests).toHaveLength(count);
  expect(await ext.dispatch("OPEN_TRANSCRIPT")).toEqual({ ok: true });
  expect(ext.openedTabs.at(-1)).toBe("https://other.example/google-meet");
});

test("side panel renders live turns safely, restores on reopen and stops polling on close", async () => {
  let recording = true;

  const replies = [
    {
      id: "one",
      sequence: 1,
      speakerName: "Speaker 1",
      text: "<script>hello</script>",
    },
  ];

  let transcriptRequests = 0;

  function popup() {
    let interval!: () => void;
    let close!: () => void;
    let storageChanged!: (changes: StorageChanges, area: string) => void;

    class Element {
      dataset: Record<string, string> = {};
      children: Element[] = [];
      parent?: Element;
      textContent = "";
      hidden = false;
      scrollTop = 0;
      clientHeight = 300;
      scrollHeight = 300;
      append(...children: Element[]) {
        for (const child of children) {
          child.parent = this;
          this.children.push(child);
        }
      }
      replaceChildren() {
        this.children = [];
      }
      get firstElementChild() {
        return this.children[0];
      }
      remove() {
        this.parent!.children = this.parent!.children.filter(
          (child) => child !== this
        );
      }
    }

    const elements = new Map<string, Element>();

    const element = (selector: string) => {
      if (!elements.has(selector)) {
        elements.set(selector, new Element());
      }

      return elements.get(selector)!;
    };

    runInNewContext(
      readFileSync(
        new URL(
          "../../../../web/public/google-meet-extension/sidepanel.js",
          import.meta.url
        ),
        "utf8"
      ),
      {
        chrome: {
          runtime: {
            async sendMessage(message: { type: string; after: number }) {
              if (message.type === "TRANSCRIPT") {
                transcriptRequests++;

                return {
                  meeting: {
                    id: "meeting",
                    state: recording ? "recording" : "finished",
                  },
                  nextCursor: 1,
                  segments: message.after ? [] : replies,
                };
              }

              return {
                captureSession: { status: recording ? "recording" : "stopped" },
                connected: true,
              };
            },
          },
          storage: {
            onChanged: {
              addListener(listener: typeof storageChanged) {
                storageChanged = listener;
              },
            },
          },
          tabs: {
            onActivated: { addListener() {} },
            onUpdated: { addListener() {} },
            async query() {
              return [{ url: "https://meet.google.com/abc-defg-hij" }];
            },
          },
        },
        clearInterval() {},
        document: {
          createElement: () => new Element(),
          createTextNode(text: string) {
            const node = new Element();
            node.textContent = text;

            return node;
          },
          querySelector: element,
        },
        setInterval(callback: () => void) {
          interval = callback;

          return 1;
        },
        setTimeout() {},
        URL,
        window: {
          addEventListener(_event: string, listener: () => void) {
            close = listener;
          },
        },
      }
    );

    return {
      close: () => close(),
      element,
      poll: () => interval(),
      reset: () => storageChanged({ meetKey: {} }, "local"),
    };
  }

  const first = popup();
  await Bun.sleep(0);
  const turn = first.element("#transcript").children[0]!;
  expect(turn.children.map((child) => child.textContent)).toEqual([
    "Speaker 1",
    "\n<script>hello</script>",
  ]);
  first.poll();
  await Bun.sleep(0);
  expect(first.element("#transcript").children).toHaveLength(1);
  first.close();
  const count = transcriptRequests;
  first.poll();
  await Bun.sleep(0);
  expect(transcriptRequests).toBe(count);
  const reopened = popup();
  await Bun.sleep(0);
  expect(reopened.element("#transcript").children).toHaveLength(1);
  recording = false;
  reopened.poll();
  await Bun.sleep(0);
  expect(reopened.element("#status").textContent).toBe("Transcript ready");
  const finishedCount = transcriptRequests;
  reopened.poll();
  await Bun.sleep(0);
  expect(transcriptRequests).toBe(finishedCount);
  reopened.reset();
  expect(reopened.element("#transcript").children).toHaveLength(0);
  reopened.close();
});
