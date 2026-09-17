import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginExecutionContext } from "@nakama/core";
import type { BetterWright } from "betterwright";
import { privateJson, run } from "./actions";
import { BrowserSetupError, openBrowser, viewerUrl } from "./browser";
import { MeetingStore } from "./store";
import { transcriptionProviders } from "./transcription";
import { GoogleConnection, runMeeting } from "./worker";

test("worker captures PCM, flushes final speech, releases capture and persists completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-worker-"));
  const store = new MeetingStore(dir, "org");
  const provider = transcriptionProviders.openai!;
  let closed = false;
  let providerClosed = false;
  let bytes = 0;
  try {
    privateJson(join(dir, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    transcriptionProviders.openai = {
      async connect({ onSegment }) {
        return {
          close() {
            providerClosed = true;
          },
          async finish() {
            onSegment({ id: "last", receivedAt: 123, text: "Final words" });
          },
          push(audio) {
            bytes += audio.length;
          },
        };
      },
    };
    await runMeeting(
      meeting,
      store,
      dir,
      new AbortController().signal,
      async ({ signal }) => ({
        audio: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(new Uint8Array(4801));
            store.stop(meeting.id);
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            });
          },
        }),
        async close() {
          closed = true;
        },
        async inCall() {
          return true;
        },
      })
    );
    expect(bytes).toBe(4800);
    expect(closed && providerClosed).toBe(true);
    expect(store.get(meeting.id)?.state).toBe("finished");
    expect(store.transcript(meeting.id).map((segment) => segment.text)).toEqual(
      ["Final words"]
    );
  } finally {
    transcriptionProviders.openai = provider;
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("capture failure is terminal and another meeting can be queued", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-worker-"));
  const store = new MeetingStore(dir, "org");
  try {
    privateJson(join(dir, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    await runMeeting(meeting, store, dir, new AbortController().signal, () =>
      Promise.reject(new Error("Admission denied"))
    );
    expect(store.get(meeting.id)?.state).toBe("failed");
    expect(store.create(meeting.url, "user", undefined, 1).state).toBe(
      "queued"
    );
  } finally {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

async function settle(connection: GoogleConnection) {
  for (let i = 0; i < 100; i++) {
    if (!["starting", "saving"].includes(connection.status().state)) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("Login did not settle");
}

test("Google login is serialized, verifies sign-in, revokes the viewer and persists only a connection marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-login-"));
  let closed = 0;
  let signedIn = false;
  let opens = 0;
  const connection = new GoogleConnection(dir, async () => {
    opens++;
    return {
      browser: {
        async run(code: string) {
          return {
            ok: true,
            result: code.includes("myaccount.google.com")
              ? signedIn
              : undefined,
          };
        },
        async startLiveView() {
          return { ok: true, url: "http://127.0.0.1:9999/?t=private-token" };
        },
      } as unknown as BetterWright,
      async close() {
        closed++;
      },
    };
  });
  try {
    await connection.command("connect");
    await expect(connection.command("disconnect")).rejects.toThrow();
    await settle(connection);
    expect(connection.status().url).toContain("private-token");
    expect(connection.busy).toBe(true);
    await connection.command("connect");
    expect(opens).toBe(1);
    await connection.command("finish-login");
    await settle(connection);
    expect(connection.authenticated).toBe(false);
    expect(connection.status().url).toBeUndefined();
    expect(closed).toBe(1);
    signedIn = true;
    await connection.command("connect");
    await settle(connection);
    await connection.command("finish-login");
    await settle(connection);
    expect(connection.authenticated).toBe(true);
    expect(connection.busy).toBe(false);
    expect(connection.status().url).toBeUndefined();
    expect(closed).toBe(2);
    mkdirSync(join(dir, "browser"), { recursive: true });
    privateJson(join(dir, "browser", "profile.json"), {
      secret: "google-cookie",
    });
    await connection.command("disconnect");
    await settle(connection);
    expect(connection.authenticated).toBe(false);
    expect(existsSync(join(dir, "browser"))).toBe(false);
  } finally {
    await connection.shutdown();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("login viewers expire and reject insecure public URLs", async () => {
  expect(
    viewerUrl("http://127.0.0.1:4311/?t=secret", "https://login.example.com")
  ).toBe("https://login.example.com/?t=secret");
  for (const origin of [
    "http://login.example.com",
    "https://login.example.com/subpath",
    "https://user:pass@login.example.com",
    "https://login.example.com/?t=other",
  ]) {
    expect(() => viewerUrl("http://127.0.0.1/?t=secret", origin)).toThrow();
  }
  const dir = mkdtempSync(join(tmpdir(), "meet-expiry-"));
  let closed = false;
  const connection = new GoogleConnection(dir, async () => ({
    browser: {
      async run() {
        return { ok: true };
      },
      async startLiveView() {
        return { ok: true, url: "http://127.0.0.1:9999/?t=secret" };
      },
    } as unknown as BetterWright,
    async close() {
      closed = true;
    },
  }));
  const now = Date.now;
  try {
    await connection.command("connect");
    await settle(connection);
    Date.now = () => now() + 11 * 60_000;
    await connection.expire();
    expect(closed).toBe(true);
    expect(connection.status().url).toBeUndefined();
    expect(connection.busy).toBe(false);
  } finally {
    Date.now = now;
    await connection.shutdown();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("worker control authenticates requests and never exposes viewer control in meeting tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-control-"));
  const workerDir = join(dir, "workers", "meet");
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("./worker.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        NAKAMA_ORG_ID: "org",
        NAKAMA_PLUGIN_DATA_DIR: dir,
        NAKAMA_WORKER_DATA_DIR: workerDir,
      },
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
    }
  );
  try {
    for (
      let i = 0;
      i < 100 && !existsSync(join(workerDir, "control.json"));
      i++
    ) {
      await Bun.sleep(20);
    }
    if (!existsSync(join(workerDir, "control.json"))) {
      throw new Error("Worker control endpoint did not start");
    }
    const endpoint = JSON.parse(
      readFileSync(join(workerDir, "control.json"), "utf8")
    ) as { port: number; token: string };
    const denied = await fetch(`http://127.0.0.1:${endpoint.port}/connection`, {
      method: "POST",
    });
    expect(denied.status).toBe(404);
    const context: PluginExecutionContext = {
      actionKey: "connection",
      actor: { id: "admin", role: "admin" },
      apiVersion: 1,
      dataDir: dir,
      invocationId: "test",
      orgId: "org",
      pluginId: "google-meet",
      pluginVersion: "0.1.0",
    };
    expect(await run({}, context)).toMatchObject({
      authenticated: false,
      state: "idle",
    });
    const publicResult = await run(
      {},
      {
        ...context,
        actionKey: "meetings",
        actor: { id: "member", role: "member" },
      }
    );
    expect(JSON.stringify(publicResult)).not.toContain(endpoint.token);
    expect(JSON.stringify(publicResult)).not.toContain("url");
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    expect(existsSync(join(workerDir, "control.json"))).toBe(false);
    rmSync(dir, { force: true, recursive: true });
  }
});

test("Mac sign-in uses installed Chrome without requiring BetterChromium", async () => {
  if (
    process.platform !== "darwin" ||
    !existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ) {
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "meet-chrome-"));
  const browserEnvironment = [
    "NAKAMA_MEET_CHROME",
    "BETTERWRIGHT_CHROMIUM_PATH",
    "BETTERWRIGHT_CHROMIUM_ROOT",
  ];
  const previous = browserEnvironment.map((key) => process.env[key]);
  for (const key of browserEnvironment) {
    delete process.env[key];
  }
  let instance: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    instance = await openBrowser(directory);
    expect(instance.browser.provider).toMatchObject({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  } finally {
    await instance?.close();
    for (const [index, key] of browserEnvironment.entries()) {
      if (previous[index] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[index];
      }
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("known browser setup failures are actionable without exposing upstream secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-setup-error-"));
  try {
    for (const error of [
      new BrowserSetupError("Install Chrome/Chromium"),
      new Error("cookie=secret; https://example.com/?t=secret"),
    ]) {
      const connection = new GoogleConnection(directory, async () => {
        throw error;
      });
      await connection.command("connect");
      await settle(connection);
      expect(connection.status().state).toBe("error");
      expect(connection.status().error).not.toContain("secret");
      if (error instanceof BrowserSetupError) {
        expect(connection.status().error).toBe(error.message);
      }
      await connection.shutdown();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
