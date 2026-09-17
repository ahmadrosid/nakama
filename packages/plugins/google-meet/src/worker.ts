import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { privateJson, readSettings } from "./actions";
import {
  BrowserSetupError,
  captureMeeting,
  openBrowser,
  runBrowser,
  viewerUrl,
} from "./browser";
import { type Meeting, MeetingStore } from "./store";
import {
  type TranscriptionSession,
  transcriptionProviders,
} from "./transcription";

export async function runMeeting(
  meeting: Meeting,
  store: MeetingStore,
  directory: string,
  signal: AbortSignal,
  capture = captureMeeting
) {
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  let audio: Awaited<ReturnType<typeof capture>> | undefined;
  let session: TranscriptionSession | undefined;
  let failure: Error | undefined;
  let ended = false;
  let checking = false;
  const deadline = Date.now() + meeting.durationMinutes * 60_000;
  const timer = setInterval(async () => {
    if (checking || combined.aborted) {
      return;
    }
    checking = true;
    try {
      if (
        store.get(meeting.id)?.stopRequested ||
        Date.now() >= deadline ||
        (audio && !(await audio.inCall()))
      ) {
        ended = true;
        abort.abort();
      }
    } catch {
      if (!combined.aborted) {
        failure = new Error("Lost the Google Meet connection");
        abort.abort();
      }
    } finally {
      checking = false;
    }
  }, 500);
  store.update(meeting.id, "joining");
  try {
    if (meeting.stopRequested) {
      ended = true;
      return;
    }
    const config = readSettings(directory);
    audio = await capture({
      directory,
      id: meeting.id,
      signal: combined,
      url: meeting.url,
    });
    combined.throwIfAborted();
    const connect = () =>
      transcriptionProviders[config.provider]!.connect({
        ...config,
        onError: (error) => {
          failure = error;
          abort.abort();
        },
        onSegment: (segment) => store.addSegment(meeting.id, segment),
        signal: combined,
      });
    let renewAt = Date.now() + 55 * 60_000;
    session = await connect();
    combined.throwIfAborted();
    store.update(meeting.id, "transcribing");
    // FFmpeg pipe reads need not align to PCM samples. Send 100ms audio frames.
    let pending = Buffer.alloc(0);
    for await (const chunk of audio.audio) {
      if (combined.aborted) {
        break;
      }
      // Renew before the provider's session limit; capture remains connected.
      if (Date.now() >= renewAt) {
        await session.finish();
        session.close();
        session = undefined;
        combined.throwIfAborted();
        renewAt = Date.now() + 55 * 60_000;
        session = await connect();
        combined.throwIfAborted();
      }
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4800) {
        session.push(pending.subarray(0, 4800));
        pending = pending.subarray(4800);
      }
    }
    if (!combined.aborted) {
      throw new Error("Meeting audio capture stopped unexpectedly");
    }
    if (pending.length >= 2) {
      session.push(pending.subarray(0, pending.length - (pending.length % 2)));
    }
  } catch (error) {
    if (!(ended || signal.aborted)) {
      failure ??=
        error instanceof Error
          ? error
          : new Error("Meeting transcription failed");
    }
  } finally {
    clearInterval(timer);
    await audio?.close();
    if (session) {
      try {
        await session.finish();
      } catch (error) {
        failure ??=
          error instanceof Error
            ? error
            : new Error("Final transcript incomplete");
      }
      session.close();
    }
    store.update(
      meeting.id,
      failure || signal.aborted ? "failed" : "finished",
      failure?.message ??
        (signal.aborted ? "Worker stopped; partial transcript saved" : null)
    );
  }
}

export class GoogleConnection {
  private instance: Awaited<ReturnType<typeof openBrowser>> | undefined;
  private pending: Promise<void> | undefined;
  private expiresAt = 0;
  private url: string | undefined;
  private error: string | undefined;
  private state = "idle";
  constructor(
    private readonly directory: string,
    private readonly open = openBrowser
  ) {}
  get authenticated() {
    return existsSync(join(this.directory, "connected.json"));
  }
  get busy() {
    return !!this.pending || !!this.instance;
  }
  status() {
    return {
      authenticated: this.authenticated,
      error: this.error,
      expiresAt: this.expiresAt,
      state: this.state,
      url: this.url,
    };
  }
  async command(action: string) {
    if (action === "connection") {
      return this.status();
    }
    if (this.pending) {
      throw new Error("Google login operation is already running");
    }
    if (action === "connect" && this.instance) {
      return this.status();
    }
    if (action === "finish-login" && !this.instance) {
      throw new Error("Start Google login first");
    }
    this.error = undefined;
    this.state = action === "connect" ? "starting" : "saving";
    this.pending = this.perform(action)
      .catch(async (error: unknown) => {
        try {
          await this.close();
        } catch {
          /* Keep the instance for a later disconnect retry. */
        }
        this.error =
          error instanceof BrowserSetupError
            ? error.message
            : action === "finish-login"
              ? "Google sign-in could not be verified. Connect again and complete sign-in."
              : "Google browser setup failed. Check BetterWright, Xvfb and viewer configuration.";
        this.state = "error";
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.status();
  }
  private async perform(action: string) {
    if (action === "connect") {
      rmSync(join(this.directory, "connected.json"), { force: true });
      // Validate before opening a browser; no public HTTP listener is allowed.
      const origin = process.env.NAKAMA_MEET_VIEWER_ORIGIN;
      if (origin) {
        viewerUrl("http://127.0.0.1/?t=test", origin);
      }
      this.instance = await this.open(this.directory);
      await runBrowser(
        this.instance.browser,
        'await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" });'
      );
      const view = await this.instance.browser.startLiveView({
        host: "127.0.0.1",
        interactive: true,
        port: Number(process.env.NAKAMA_MEET_VIEWER_PORT ?? 0),
      });
      if (!(view.ok && view.url)) {
        throw new Error("Viewer unavailable");
      }
      this.url = viewerUrl(view.url, origin);
      this.expiresAt = Date.now() + 10 * 60_000;
      this.state = "signing-in";
      return;
    }
    if (action === "finish-login") {
      const authenticated = await runBrowser<boolean>(
        this.instance!.browser,
        `
        await page.goto("https://myaccount.google.com/?hl=en", { waitUntil: "domcontentloaded" });
        return await page.evaluate(() => location.hostname === "myaccount.google.com" && !!document.querySelector('a[href*="SignOutOptions"], [aria-label^="Google Account:"]'));
      `
      );
      if (authenticated !== true) {
        throw new Error("Not signed in");
      }
      await this.close();
      privateJson(join(this.directory, "connected.json"), {
        connectedAt: Date.now(),
      });
    } else if (action === "disconnect") {
      rmSync(join(this.directory, "connected.json"), { force: true });
      await this.close();
      rmSync(join(this.directory, "browser"), { force: true, recursive: true });
      rmSync(join(this.directory, "auth.json"), { force: true });
    }
    this.state = "idle";
  }
  async expire() {
    if (!this.pending && this.expiresAt && Date.now() >= this.expiresAt) {
      this.pending = this.close().finally(() => {
        this.pending = undefined;
        this.state = "idle";
      });
      await this.pending;
    }
  }
  async close() {
    const instance = this.instance;
    this.url = undefined;
    this.expiresAt = 0;
    await instance?.close();
    this.instance = undefined;
  }
  async shutdown() {
    await this.pending;
    await this.close();
  }
}

async function runWorker(directory: string, dataDir: string, orgId: string) {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const store = new MeetingStore(dataDir, orgId);
  store.recover();
  const connection = new GoogleConnection(dataDir);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let meetingActive = false;
  const token = crypto.randomUUID();
  const control = Bun.serve({
    async fetch(request) {
      if (
        request.method !== "POST" ||
        request.headers.get("authorization") !== `Bearer ${token}`
      ) {
        return new Response(null, { status: 404 });
      }
      const action = new URL(request.url).pathname.slice(1);
      if (
        !["connect", "connection", "finish-login", "disconnect"].includes(
          action
        )
      ) {
        return new Response(null, { status: 404 });
      }
      try {
        if (
          abort.signal.aborted ||
          (action !== "connection" && meetingActive) ||
          (action === "connect" && !connection.busy && store.next())
        ) {
          throw new Error(
            "Leave the active meeting before changing Google login"
          );
        }
        return Response.json(await connection.command(action), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : "Login request failed",
          },
          { status: 409 }
        );
      }
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  privateJson(join(directory, "control.json"), { port: control.port, token });
  const status = () =>
    privateJson(join(directory, "status.json"), {
      authenticated: connection.authenticated,
      loginBusy: connection.busy,
      state: abort.signal.aborted ? "stopped" : "ready",
      updatedAt: Date.now(),
    });
  status();
  const heartbeat = setInterval(status, 3000);
  try {
    while (!abort.signal.aborted) {
      await connection.expire();
      const next = connection.busy ? undefined : store.next();
      if (next) {
        if (!connection.authenticated) {
          store.update(
            next.id,
            "failed",
            "Connect Google in Settings before joining"
          );
          continue;
        }
        meetingActive = true;
        try {
          await runMeeting(next, store, dataDir, abort.signal);
        } finally {
          meetingActive = false;
        }
      } else {
        await Bun.sleep(500);
      }
    }
  } finally {
    clearInterval(heartbeat);
    control.stop(true);
    rmSync(join(directory, "control.json"), { force: true });
    await connection.shutdown();
    status();
    store.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

if (import.meta.main) {
  const directory = process.env.NAKAMA_WORKER_DATA_DIR;
  const dataDir = process.env.NAKAMA_PLUGIN_DATA_DIR;
  const orgId = process.env.NAKAMA_ORG_ID;
  if (!(directory && dataDir && orgId)) {
    throw new Error("Start this worker through Nakama");
  }
  await runWorker(directory, dataDir, orgId);
}
