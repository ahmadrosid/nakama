import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function extension() {
  const listeners: Array<(message: any, sender: any, reply: any) => unknown> =
    [];
  const state: Record<string, any> = {};
  const calls: Array<{ action: string; input: unknown }> = [];
  const tabs = new Map([
    [1, { id: 1, url: "https://nakama.example/plugins/google-meet" }],
    [2, { id: 2, url: "https://meet.google.com/abc-defg-hij?authuser=0" }],
  ]);
  let active = 1;
  let failCapture = false;
  const openedTabs: string[] = [];
  let badge = "";
  const chrome = {
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText({ text }: { text: string }) {
        badge = text;
      },
    },
    offscreen: { async createDocument() {} },
    runtime: {
      async getContexts() {
        return [];
      },
      getURL: (file: string) => `chrome-extension://test-extension/${file}`,
      id: "test-extension",
      onMessage: {
        addListener(fn: (message: any, sender: any, reply: any) => unknown) {
          listeners.push(fn);
        },
      },
      async sendMessage(message: any) {
        if (message.type === "START_CAPTURE") {
          expect(message.captureUrl).toBe(state.captureSession.captureUrl);
        }
        return failCapture
          ? { error: "Capture denied", needsMicrophone: true }
          : { ok: true };
      },
    },
    storage: {
      session: {
        async get(keys: string | string[]) {
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [
              key,
              state[key],
            ])
          );
        },
        async remove(key: string) {
          delete state[key];
        },
        async set(value: Record<string, unknown>) {
          Object.assign(state, value);
        },
      },
    },
    tabCapture: {
      async getMediaStreamId() {
        return "stream";
      },
    },
    tabs: {
      async create({ url }: { url: string }) {
        openedTabs.push(url);
      },
      async get(id: number) {
        return tabs.get(id);
      },
      onRemoved: { addListener() {} },
      async query() {
        return [tabs.get(active)];
      },
      async sendMessage(_id: number, message: any) {
        calls.push(message);
        return {
          result:
            message.action === "start-capture"
              ? {
                  capture: { url: "wss://capture.example/capture?token=test" },
                  id: "meeting",
                }
              : { captureProtocol: 2, configured: true },
        };
      },
    },
  };
  runInNewContext(
    readFileSync(
      new URL("../extension/background.js", import.meta.url),
      "utf8"
    ),
    { chrome, URL }
  );
  const sender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL("popup.html"),
  };
  return {
    activate(id: number) {
      active = id;
    },
    badge: () => badge,
    calls,
    async captureEvent(type: string) {
      listeners[1]!(
        { type },
        { ...sender, url: chrome.runtime.getURL("offscreen.html") },
        () => undefined
      );
      await Bun.sleep(0);
    },
    dispatch(type: string) {
      return new Promise<any>((resolve) =>
        listeners[0]!({ type }, sender, resolve)
      );
    },
    failCapture(value = true) {
      failCapture = value;
    },
    fromPage(type: string) {
      return listeners[0]!(
        { type },
        { ...sender, tab: tabs.get(1), url: tabs.get(1)!.url },
        () => {
          throw new Error("Page gained capture access");
        }
      );
    },
    openedTabs,
    state,
    tabs,
  };
}

test("extension connects once, starts the active Meet tab and rejects duplicate starts", async () => {
  const ext = extension();
  expect(await ext.dispatch("CONNECT")).toEqual({ ok: true });
  ext.activate(2);
  expect(await ext.dispatch("START")).toEqual({ ok: true });
  expect(
    ext.calls.find((call) => call.action === "start-capture")?.input
  ).toEqual({ url: "https://meet.google.com/abc-defg-hij" });
  expect(ext.state.captureSession.tabId).toBe(2);
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(
    ext.calls.filter((call) => call.action === "start-capture")
  ).toHaveLength(1);
  expect(ext.fromPage("START")).toBeUndefined();
  expect(ext.fromPage("CONNECT")).toBeUndefined();
  await ext.captureEvent("CAPTURE_STARTED");
  expect(ext.state.captureSession.status).toBe("recording");
  await ext.captureEvent("CAPTURE_STOPPED");
  expect(ext.state.captureSession.status).toBe("stopped");
  expect(ext.calls.at(-1)).toMatchObject({
    action: "leave",
    input: { meetingId: "meeting" },
  });
});

test("extension requires a connected Nakama tab and cancels sessions when capture fails", async () => {
  const ext = extension();
  ext.activate(2);
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.calls).toHaveLength(0);
  ext.activate(1);
  await ext.dispatch("CONNECT");
  ext.activate(2);
  ext.failCapture();
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.calls.at(-1)).toMatchObject({
    action: "leave",
    input: { meetingId: "meeting" },
  });
  expect(ext.openedTabs).toEqual([
    "chrome-extension://test-extension/microphone.html",
  ]);
  const reopened = await ext.dispatch("STATE");
  expect(reopened.captureSession).toMatchObject({
    error: "Capture denied",
    status: "error",
  });
  expect(ext.badge()).toBe("!");
  ext.tabs.get(1)!.url = "https://other.example/plugins/google-meet";
  const count = ext.calls.length;
  expect((await ext.dispatch("START")).error).toBeDefined();
  expect(ext.calls).toHaveLength(count);
  ext.tabs.get(1)!.url = "https://nakama.example/plugins/google-meet";
  ext.failCapture(false);
  expect(await ext.dispatch("START")).toEqual({ ok: true });
  await ext.captureEvent("CAPTURE_STARTED");
  expect((await ext.dispatch("STATE")).captureSession.error).toBeUndefined();
  expect(ext.badge()).toBe("REC");
});

test("audio worklet encodes every mono sample as PCM16 and tolerates empty input", () => {
  const messages: ArrayBuffer[] = [];
  let Processor: any;
  runInNewContext(
    readFileSync(
      new URL("../extension/audio-worklet.js", import.meta.url),
      "utf8"
    ),
    {
      AudioWorkletProcessor: class {
        port = {
          postMessage(buffer: ArrayBuffer) {
            messages.push(buffer);
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
  expect(Array.from(new Int16Array(messages[0]!))).toEqual([
    -32_768, -32_768, -16_384, 0, 16_383, 32_767, 32_767,
  ]);
  processor.process([[new Float32Array([0.25])]]);
  expect(Array.from(new Int16Array(messages[1]!))).toEqual([8191]);
  processor.port.onmessage({ data: "flush" });
  expect(messages.at(-1)).toBe("flushed");
  expect(processor.process([[new Float32Array([1])]])).toBe(false);
  expect(messages).toHaveLength(3);
});

test.each(["connected", "throw", "reject", "invalidated"])(
  "content bridge handles runtime state: %s",
  async (state) => {
    let receive!: (event: unknown) => Promise<void>;
    let sends = 0;
    const messages: unknown[] = [];
    const page = {
      addEventListener(_name: string, listener: typeof receive) {
        receive = listener;
      },
      postMessage(message: unknown) {
        messages.push(message);
      },
    };
    const location = {
      hostname: "localhost",
      origin: "http://localhost:3003",
      pathname: "/customize",
    };
    runInNewContext(
      readFileSync(new URL("../extension/content.js", import.meta.url), "utf8"),
      {
        chrome: {
          runtime: {
            id: state === "invalidated" ? undefined : "extension",
            onMessage: { addListener() {} },
            sendMessage() {
              sends++;
              if (state === "throw") {
                throw new Error("Extension context invalidated.");
              }
              return state === "reject"
                ? Promise.reject(new Error("Extension context invalidated."))
                : Promise.resolve({ connected: true });
            },
          },
        },
        location,
        window: page,
      }
    );
    location.pathname = "/plugins/google-meet";
    await receive({
      data: { type: "NAKAMA_MEET_PING" },
      origin: "http://localhost:3003",
      source: page,
    });
    expect(messages).toEqual([
      { connected: state === "connected", type: "NAKAMA_MEET_EXTENSION" },
    ]);
    expect(sends).toBe(state === "invalidated" ? 0 : 1);
  }
);

test("popup shows setup progress and only the available capture action", async () => {
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
      readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8"),
      {
        chrome: {
          runtime: {
            async sendMessage() {
              return {
                captureSession: recording ? { status: "recording" } : undefined,
                connection: connected ? { tabId: 1 } : undefined,
              };
            },
          },
          storage: { onChanged: { addListener() {} } },
          tabs: {
            async query() {
              return [
                {
                  url: onMeet
                    ? "https://meet.google.com/abc-defg-hij"
                    : "https://nakama.example/plugins/google-meet",
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
    expect(element("#connect").hidden).toBe(onMeet || recording);
    expect(element("#start").hidden).toBe(!(connected && onMeet) || recording);
    expect(element("#stop").hidden).toBe(!recording);
    expect(element("#connection").dataset.connected).toBe(String(connected));
    expect(element("#connect-step").dataset.done).toBe(String(connected));
    expect(element("#meet-step").dataset.done).toBe(
      String(onMeet || recording)
    );
  }
});

test("extension clears a connection when its Nakama tab closes or navigates away", async () => {
  const ext = extension();
  await ext.dispatch("CONNECT");
  ext.tabs.get(1)!.url = "https://other.example/";
  expect((await ext.dispatch("STATE")).connection).toBeUndefined();
  expect(ext.state.connection).toBeUndefined();
  ext.tabs.get(1)!.url = "https://nakama.example/plugins/google-meet";
  await ext.dispatch("CONNECT");
  ext.tabs.delete(1);
  expect((await ext.dispatch("STATE")).connection).toBeUndefined();
});

test.each([false, true])(
  "offscreen capture handles microphone denied=%s",
  async (denied) => {
    let listener: any;
    let socket: any;
    let processor: any;
    let stopped = 0;
    const events: string[] = [];
    const frames: unknown[] = [];
    const track = {
      stop() {
        stopped++;
      },
    };
    const captureUrl = "wss://capture.example/capture?token=test";
    runInNewContext(
      readFileSync(
        new URL("../extension/offscreen.js", import.meta.url),
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
            onmessage: null as any,
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
          send(frame: unknown) {
            frames.push(frame);
            if (typeof frame === "string") {
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
        { captureUrl, streamId: "stream", type: "START_CAPTURE" },
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
    expect(frames).toEqual([frame]);
    expect(events).toEqual(["CAPTURE_STARTED"]);
    expect(stopped).toBe(0);
    await new Promise((resolve) =>
      listener({ type: "STOP_CAPTURE" }, sender, resolve)
    );
    expect(events).toEqual(["CAPTURE_STARTED", "CAPTURE_STOPPED"]);
    expect(stopped).toBeGreaterThanOrEqual(2);
  }
);

test("popup transcript access is bound to its captured meeting and unavailable to pages", async () => {
  const ext = extension();
  await ext.dispatch("CONNECT");
  ext.activate(2);
  await ext.dispatch("START");
  await ext.dispatch("TRANSCRIPT");
  expect(ext.calls.at(-1)).toMatchObject({
    action: "transcript",
    input: { after: 0, meetingId: "meeting" },
  });
  expect(ext.fromPage("TRANSCRIPT")).toBeUndefined();
  await ext.captureEvent("CAPTURE_STOPPED");
  await ext.dispatch("TRANSCRIPT");
  expect(ext.calls.at(-1)?.action).toBe("transcript");
  ext.state.connection = { tabId: 99, url: "https://other.example" };
  expect(await ext.dispatch("TRANSCRIPT")).toBeNull();
});

test("popup renders live turns safely, restores on reopen and stops polling on close", async () => {
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
    let storageChanged!: (changes: unknown, area: string) => void;
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
      readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8"),
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
                connection: { tabId: 1 },
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
      reset: () => storageChanged({ connection: {} }, "session"),
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
