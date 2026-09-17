// @bun
var __require = import.meta.require;

// src/worker.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, rmSync as rmSync3 } from "fs";
import { join as join4 } from "path";

// src/actions.ts
import { existsSync as existsSync2, readFileSync, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2 } from "path";

// src/store.ts
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "fs";
import { join } from "path";

class MeetingStore {
  directory;
  db;
  constructor(directory, orgId) {
    this.directory = directory;
    mkdirSync(directory, { mode: 448, recursive: true });
    const path = join(directory, "meetings.sqlite");
    this.db = new Database(path);
    chmodSync(path, 384);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tenant (id INTEGER PRIMARY KEY CHECK(id=1), orgId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, actorId TEXT NOT NULL, profileId TEXT, url TEXT NOT NULL,
        state TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
        durationMinutes INTEGER NOT NULL, stopRequested INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_meeting ON meetings ((1))
        WHERE state IN ('queued','joining','transcribing');
      CREATE TABLE IF NOT EXISTS segments (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, meetingId TEXT NOT NULL,
        id TEXT NOT NULL, text TEXT NOT NULL, receivedAt INTEGER NOT NULL,
        UNIQUE(meetingId,id));`);
    this.db.query("INSERT OR IGNORE INTO tenant VALUES (1, ?)").run(orgId);
    if (this.db.query("SELECT orgId FROM tenant WHERE id=1").get()?.orgId !== orgId) {
      this.db.close();
      throw new Error("Meeting data belongs to another organization");
    }
    try {
      this.restoreTranscripts(false);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  create(url, actorId, profileId, durationMinutes) {
    if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url)) {
      throw new Error("Use a Google Meet link such as https://meet.google.com/abc-defg-hij");
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 120) {
      throw new Error("Meeting duration must be between 1 and 120 minutes");
    }
    const id = randomUUID();
    try {
      this.db.query("INSERT INTO meetings (id,actorId,profileId,url,state,createdAt,updatedAt,durationMinutes) VALUES (?,?,?,?,'queued',?,?,?)").run(id, actorId, profileId ?? null, url, Date.now(), Date.now(), durationMinutes);
    } catch {
      throw new Error("An active meeting already exists in this organization");
    }
    return this.get(id);
  }
  get(id) {
    return this.db.query("SELECT * FROM meetings WHERE id=?").get(id);
  }
  list(actorId = null, profileId = null) {
    return this.db.query("SELECT * FROM meetings WHERE (? IS NULL OR actorId=?) AND (? IS NULL OR profileId=?) ORDER BY createdAt DESC LIMIT 100").all(actorId, actorId, profileId, profileId).map((meeting) => ({
      ...meeting,
      transcriptFile: existsSync(this.transcriptPath(meeting.id)) ? `meeting-${meeting.id}.txt` : undefined
    }));
  }
  next() {
    return this.db.query("SELECT * FROM meetings WHERE state='queued' LIMIT 1").get();
  }
  recover() {
    this.db.query("UPDATE meetings SET state='failed', error='Meeting worker restarted; partial transcript saved',updatedAt=? WHERE state IN ('joining','transcribing')").run(Date.now());
    this.restoreTranscripts(true);
  }
  update(id, state, error = null) {
    this.db.query("UPDATE meetings SET state=?,error=?,updatedAt=? WHERE id=?").run(state, error, Date.now(), id);
  }
  stop(id) {
    this.db.query("UPDATE meetings SET stopRequested=1 WHERE id=?").run(id);
  }
  addSegment(meetingId, segment) {
    if (!this.get(meetingId)) {
      throw new Error("Meeting not found");
    }
    this.db.query("INSERT OR IGNORE INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)").run(meetingId, segment.id, segment.text, segment.receivedAt);
    this.saveTranscript(meetingId);
  }
  transcriptPath(id) {
    return join(this.directory, "transcripts", `meeting-${id}.txt`);
  }
  restoreTranscripts(overwrite) {
    const meetings = this.db.query("SELECT id FROM meetings WHERE EXISTS (SELECT 1 FROM segments WHERE meetingId=meetings.id)").all();
    for (const meeting of meetings) {
      if (overwrite || !existsSync(this.transcriptPath(meeting.id))) {
        this.saveTranscript(meeting.id);
      }
    }
  }
  saveTranscript(id) {
    this.db.transaction(() => {
      const rows = this.db.query("SELECT text FROM segments WHERE meetingId=? ORDER BY sequence").all(id);
      mkdirSync(join(this.directory, "transcripts"), {
        mode: 448,
        recursive: true
      });
      const path = this.transcriptPath(id);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, rows.map((row) => `${row.text}
`).join(""), { mode: 384 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }).immediate();
  }
  transcript(id, after = 0) {
    return this.db.query("SELECT sequence,id,text,receivedAt FROM segments WHERE meetingId=? AND sequence>? ORDER BY sequence LIMIT 2000").all(id, after);
  }
  close() {
    this.db.close();
  }
}

// src/transcription.ts
function transcriptionConfig(value) {
  const provider = value.provider ?? "openai";
  const model = value.model ?? "gpt-transcribe";
  if (provider !== "openai" || model !== "gpt-transcribe") {
    throw new Error("Unsupported transcription provider or model");
  }
  if (typeof value.apiKey !== "string" || !value.apiKey.trim() || value.apiKey.length > 4096) {
    throw new Error("An OpenAI API key is required for transcription");
  }
  return { apiKey: value.apiKey.trim(), model, provider };
}

class OpenAITranscript {
  order = [];
  completed = new Map;
  seen = new Set;
  accept(event) {
    if (event.type === "conversation.item.input_audio_transcription.failed" || event.type === "error") {
      throw new Error("Transcription failed; check the API key, model access, and API balance");
    }
    const id = typeof event.item_id === "string" ? event.item_id : undefined;
    if (!id) {
      return;
    }
    if (event.type === "input_audio_buffer.committed" && !this.seen.has(id)) {
      this.seen.add(id);
      this.order.push(id);
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string" && this.order.includes(id)) {
      this.completed.set(id, {
        id,
        receivedAt: Date.now(),
        text: event.transcript.trim()
      });
    }
  }
  drain() {
    const result = [];
    while (this.order[0] && this.completed.has(this.order[0])) {
      const id = this.order.shift();
      const segment = this.completed.get(id);
      this.completed.delete(id);
      if (segment.text) {
        result.push(segment);
      }
    }
    return result;
  }
  get pending() {
    return this.order.length;
  }
}
var openai = {
  async connect({ apiKey, model, signal, onSegment, onError }) {
    signal.throwIfAborted();
    const Socket = WebSocket;
    const socket = new Socket("wss://api.openai.com/v1/realtime?intent=transcription", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const transcript = new OpenAITranscript;
    let closing = false;
    let ready = false;
    let failure;
    let sentAudio = false;
    let finalCommit = false;
    let finishing = false;
    let lastEvent = Date.now();
    let resolveReady;
    let rejectReady;
    const connected = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const fail = (error) => {
      if (failure || closing) {
        return;
      }
      failure = error;
      rejectReady(error);
      if (ready) {
        onError(error);
      }
    };
    const timeout = setTimeout(() => fail(new Error("Transcription connection timed out")), 15000);
    const abort = () => fail(new Error("Transcription connection cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      session: {
        audio: {
          input: {
            format: { rate: 24000, type: "audio/pcm" },
            transcription: { model },
            turn_detection: {
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
              threshold: 0.5,
              type: "server_vad"
            }
          }
        },
        type: "transcription"
      },
      type: "session.update"
    })));
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data));
        lastEvent = Date.now();
        if (event.type === "session.updated") {
          ready = true;
          resolveReady();
        }
        if (event.type === "input_audio_buffer.committed") {
          finalCommit = false;
        }
        if (event.type === "error" && finishing && event.error?.code === "input_audio_buffer_commit_empty") {
          finalCommit = false;
          return;
        }
        transcript.accept(event);
        for (const segment of transcript.drain()) {
          onSegment(segment);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid transcription response"));
      }
    });
    socket.addEventListener("error", () => fail(new Error("Transcription connection failed")));
    socket.addEventListener("close", () => fail(new Error("Transcription connection closed unexpectedly")));
    try {
      await connected;
    } catch (error) {
      closing = true;
      socket.close();
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    return {
      close() {
        closing = true;
        socket.close();
      },
      async finish() {
        if (failure) {
          throw failure;
        }
        if (!sentAudio) {
          return;
        }
        finishing = true;
        finalCommit = true;
        lastEvent = Date.now();
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (failure) {
            throw failure;
          }
          if (!finalCommit && transcript.pending === 0 && Date.now() - lastEvent > 250) {
            return;
          }
          await Bun.sleep(50);
        }
        throw new Error("Timed out waiting for the final transcript; partial transcript was saved");
      },
      push(audio) {
        if (failure) {
          throw failure;
        }
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2400000) {
          throw new Error("Transcription connection cannot keep up with meeting audio");
        }
        sentAudio = true;
        socket.send(JSON.stringify({
          audio: Buffer.from(audio).toString("base64"),
          type: "input_audio_buffer.append"
        }));
      }
    };
  }
};
var transcriptionProviders = {
  openai
};

// src/actions.ts
function privateJson(path, data) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync2(temporary, JSON.stringify(data), { mode: 384 });
  renameSync2(temporary, path);
}
function readSettings(directory) {
  return transcriptionConfig(JSON.parse(readFileSync(join2(directory, "settings.json"), "utf8")));
}

// src/browser.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2 } from "fs";
import { join as join3 } from "path";
import { pathToFileURL } from "url";

class BrowserSetupError extends Error {
}
function installedRuntime() {
  const configDir = process.env.NAKAMA_PLUGIN_WORKER_ROOT;
  return configDir ? join3(configDir, "runtimes", "google-meet") : undefined;
}
function installedBrowser() {
  const root = installedRuntime();
  if (!root) {
    return;
  }
  try {
    const saved = JSON.parse(readFileSync2(join3(root, "browser.json"), "utf8"));
    return typeof saved.path === "string" && existsSync3(saved.path) ? saved.path : undefined;
  } catch {}
}
function browserOptions(directory) {
  const managedBrowser = process.env.BETTERWRIGHT_CHROMIUM_PATH || process.env.BETTERWRIGHT_CHROMIUM_ROOT;
  const executablePath = process.env.NAKAMA_MEET_CHROME || installedBrowser() || (managedBrowser ? undefined : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome"
  ].find(existsSync3));
  return {
    adBlock: false,
    chromiumArgs: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage"
    ],
    credentialCapture: false,
    downloadPolicy: "deny",
    headless: false,
    home: join3(directory, "browser"),
    locale: "en-US",
    parkBackgroundPages: false,
    ...executablePath ? { provider: { executablePath } } : {},
    vault: false
  };
}
function viewerUrl(localUrl, origin) {
  if (!origin) {
    return localUrl;
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new BrowserSetupError("Viewer origin must be an HTTPS origin without a path");
  }
  url.search = new URL(localUrl).search;
  return url.href;
}
async function command(args) {
  const child = Bun.spawn(args, {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "pipe"
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 1e4);
  try {
    const output = await new Response(child.stdout).text();
    if (await child.exited !== 0) {
      throw new Error(`${args[0]} failed; check the Google Meet worker prerequisites`);
    }
    return output.trim();
  } finally {
    clearTimeout(timer);
  }
}
async function openBrowser(directory) {
  const options = browserOptions(directory);
  mkdirSync2(options.home, { mode: 448, recursive: true });
  let display;
  const previousDisplay = process.env.DISPLAY;
  let browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      display?.kill("SIGTERM");
      if (display) {
        await display.exited;
      }
      if (previousDisplay === undefined) {
        delete process.env.DISPLAY;
      } else {
        process.env.DISPLAY = previousDisplay;
      }
    }
  };
  try {
    if (process.platform === "linux") {
      if (!Bun.which("Xvfb")) {
        throw new BrowserSetupError("Install Xvfb for the BetterWright browser on Linux");
      }
      display = Bun.spawn([
        "Xvfb",
        "-displayfd",
        "1",
        "-terminate",
        "-screen",
        "0",
        "1280x900x24",
        "-nolisten",
        "tcp"
      ], { stderr: "ignore", stdin: "ignore", stdout: "pipe" });
      const timer = setTimeout(() => display?.kill("SIGKILL"), 5000);
      try {
        const reader = display.stdout.getReader();
        const first = await reader.read();
        reader.releaseLock();
        const number = new TextDecoder().decode(first.value).trim();
        if (!/^\d+$/.test(number)) {
          throw new Error("Xvfb failed to create a browser display");
        }
        process.env.DISPLAY = `:${number}`;
      } finally {
        clearTimeout(timer);
      }
    }
    const runtime = process.env.NAKAMA_MEET_BETTERWRIGHT_PATH;
    const defaultRuntime = "/opt/nakama-meet/node_modules/betterwright/dist/src/index.js";
    const root = installedRuntime();
    const downloadedRuntime = root ? join3(root, "sdk-2.8.1-0.5.10/node_modules/betterwright/dist/src/index.js") : undefined;
    const modulePath = runtime || (downloadedRuntime && existsSync3(downloadedRuntime) ? downloadedRuntime : undefined) || (existsSync3(defaultRuntime) ? defaultRuntime : undefined);
    const sdk = await (modulePath ? import(pathToFileURL(modulePath).href) : import("betterwright"));
    browser = new sdk.BetterWright(options);
    return { browser, close };
  } catch (error) {
    await close();
    throw error;
  }
}
async function runBrowser(browser, code, signal) {
  const result = await browser.run(code, {
    automaticUI: false,
    signal,
    timeout: 30
  });
  if (!result.ok) {
    if (result.error?.includes("BetterChromium is required but not installed")) {
      throw new BrowserSetupError("Install Chrome/Chromium, set NAKAMA_MEET_CHROME, or run betterwright setup to install BetterChromium.");
    }
    throw new Error("Google Meet browser operation failed");
  }
  return result.result;
}
function meetState(shouldJoin) {
  const text = document.body.innerText;
  if (location.hostname === "accounts.google.com") {
    return "auth";
  }
  if (/You can't join|You were removed|No one responded|You couldn't join/i.test(text)) {
    return "denied";
  }
  const buttons = [...document.querySelectorAll("button")];
  if (buttons.some((button) => /leave call/i.test(button.getAttribute("aria-label") ?? ""))) {
    return "admitted";
  }
  if (shouldJoin) {
    let mutedControls = false;
    for (const button of buttons) {
      if (/turn off (microphone|camera)/i.test(button.getAttribute("aria-label") ?? "")) {
        button.click();
        mutedControls = true;
      }
    }
    if (mutedControls) {
      return "waiting";
    }
    if (!["microphone", "camera"].every((device) => buttons.some((button) => (button.getAttribute("aria-label") ?? "").toLowerCase().includes(`turn on ${device}`)))) {
      return "waiting";
    }
    const join4 = buttons.find((button) => /^(Join now|Ask to join)$/.test(button.innerText.trim()));
    if (join4) {
      join4.click();
      return "clicked";
    }
  }
  return "waiting";
}
async function captureMeeting(options) {
  if (process.platform !== "linux") {
    throw new Error("Meeting audio capture currently requires Linux");
  }
  if (!(Bun.which("ffmpeg") && Bun.which("pactl"))) {
    throw new Error("Install ffmpeg, pulseaudio, and pulseaudio-utils first");
  }
  try {
    await command(["pactl", "info"]);
  } catch {
    await command(["pulseaudio", "--start", "--exit-idle-time=-1"]);
  }
  const sink = `nakama_meet_${options.id.replaceAll("-", "")}`;
  const moduleId = await command([
    "pactl",
    "load-module",
    "module-null-sink",
    `sink_name=${sink}`,
    "rate=48000",
    "channels=2"
  ]);
  const previousSink = process.env.PULSE_SINK;
  process.env.PULSE_SINK = sink;
  let instance;
  let recording;
  let closing;
  const close = () => {
    closing ??= (async () => {
      recording?.kill("SIGTERM");
      const kill = setTimeout(() => recording?.kill("SIGKILL"), 2000);
      try {
        await instance?.close();
        await recording?.exited;
      } finally {
        clearTimeout(kill);
        if (previousSink === undefined) {
          delete process.env.PULSE_SINK;
        } else {
          process.env.PULSE_SINK = previousSink;
        }
        await command(["pactl", "unload-module", moduleId]).catch(() => {
          return;
        });
      }
    })();
    return closing;
  };
  const abort = () => {
    close().catch(() => {
      return;
    });
  };
  try {
    options.signal.throwIfAborted();
    instance = await openBrowser(options.directory);
    options.signal.throwIfAborted();
    options.signal.addEventListener("abort", abort, { once: true });
    const browser = instance.browser;
    await runBrowser(browser, `await page.goto(${JSON.stringify(options.url)}, { waitUntil: "domcontentloaded" });`, options.signal);
    const deadline = Date.now() + 300000;
    let admitted = false;
    let clicked = false;
    while (Date.now() < deadline) {
      options.signal.throwIfAborted();
      const state = await runBrowser(browser, `return await page.evaluate(${meetState.toString()}, ${!clicked});`, options.signal);
      if (state === "auth") {
        rmSync2(join3(options.directory, "connected.json"), { force: true });
        throw new Error("Google login expired; reconnect in Google Meet settings");
      }
      if (state === "denied") {
        throw new Error("Google Meet denied admission or removed the bot");
      }
      if (state === "clicked") {
        clicked = true;
      }
      if (state === "admitted") {
        admitted = true;
        break;
      }
      await Bun.sleep(500);
    }
    if (!admitted) {
      throw new Error("The bot was not admitted within five minutes");
    }
    recording = Bun.spawn([
      "ffmpeg",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "pulse",
      "-i",
      `${sink}.monitor`,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      "pipe:1"
    ], { stderr: "ignore", stdin: "ignore", stdout: "pipe" });
    return {
      audio: recording.stdout,
      async close() {
        options.signal.removeEventListener("abort", abort);
        await close();
      },
      async inCall() {
        return await runBrowser(browser, `return await page.evaluate(${meetState.toString()}, false);`, options.signal) === "admitted";
      }
    };
  } catch (error) {
    options.signal.removeEventListener("abort", abort);
    await close();
    throw error;
  }
}

// src/worker.ts
async function runMeeting(meeting, store, directory, signal, capture = captureMeeting) {
  const abort = new AbortController;
  const combined = AbortSignal.any([signal, abort.signal]);
  let audio;
  let session;
  let failure;
  let ended = false;
  let checking = false;
  const deadline = Date.now() + meeting.durationMinutes * 60000;
  const timer = setInterval(async () => {
    if (checking || combined.aborted) {
      return;
    }
    checking = true;
    try {
      if (store.get(meeting.id)?.stopRequested || Date.now() >= deadline || audio && !await audio.inCall()) {
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
      url: meeting.url
    });
    combined.throwIfAborted();
    const connect = () => transcriptionProviders[config.provider].connect({
      ...config,
      onError: (error) => {
        failure = error;
        abort.abort();
      },
      onSegment: (segment) => store.addSegment(meeting.id, segment),
      signal: combined
    });
    let renewAt = Date.now() + 55 * 60000;
    session = await connect();
    combined.throwIfAborted();
    store.update(meeting.id, "transcribing");
    let pending = Buffer.alloc(0);
    for await (const chunk of audio.audio) {
      if (combined.aborted) {
        break;
      }
      if (Date.now() >= renewAt) {
        await session.finish();
        session.close();
        session = undefined;
        combined.throwIfAborted();
        renewAt = Date.now() + 55 * 60000;
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
      session.push(pending.subarray(0, pending.length - pending.length % 2));
    }
  } catch (error) {
    if (!(ended || signal.aborted)) {
      failure ??= error instanceof Error ? error : new Error("Meeting transcription failed");
    }
  } finally {
    clearInterval(timer);
    await audio?.close();
    if (session) {
      try {
        await session.finish();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error("Final transcript incomplete");
      }
      session.close();
    }
    store.update(meeting.id, failure || signal.aborted ? "failed" : "finished", failure?.message ?? (signal.aborted ? "Worker stopped; partial transcript saved" : null));
  }
}

class GoogleConnection {
  directory;
  open;
  instance;
  pending;
  expiresAt = 0;
  url;
  error;
  state = "idle";
  constructor(directory, open = openBrowser) {
    this.directory = directory;
    this.open = open;
  }
  get authenticated() {
    return existsSync4(join4(this.directory, "connected.json"));
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
      url: this.url
    };
  }
  async command(action) {
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
    this.pending = this.perform(action).catch(async (error) => {
      try {
        await this.close();
      } catch {}
      this.error = error instanceof BrowserSetupError ? error.message : action === "finish-login" ? "Google sign-in could not be verified. Connect again and complete sign-in." : "Google browser setup failed. Check BetterWright, Xvfb and viewer configuration.";
      this.state = "error";
    }).finally(() => {
      this.pending = undefined;
    });
    return this.status();
  }
  async perform(action) {
    if (action === "connect") {
      rmSync3(join4(this.directory, "connected.json"), { force: true });
      const origin = process.env.NAKAMA_MEET_VIEWER_ORIGIN;
      if (origin) {
        viewerUrl("http://127.0.0.1/?t=test", origin);
      }
      this.instance = await this.open(this.directory);
      await runBrowser(this.instance.browser, 'await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" });');
      const view = await this.instance.browser.startLiveView({
        host: "127.0.0.1",
        interactive: true,
        port: Number(process.env.NAKAMA_MEET_VIEWER_PORT ?? 0)
      });
      if (!(view.ok && view.url)) {
        throw new Error("Viewer unavailable");
      }
      this.url = viewerUrl(view.url, origin);
      this.expiresAt = Date.now() + 10 * 60000;
      this.state = "signing-in";
      return;
    }
    if (action === "finish-login") {
      const authenticated = await runBrowser(this.instance.browser, `
        await page.goto("https://myaccount.google.com/?hl=en", { waitUntil: "domcontentloaded" });
        return await page.evaluate(() => location.hostname === "myaccount.google.com" && !!document.querySelector('a[href*="SignOutOptions"], [aria-label^="Google Account:"]'));
      `);
      if (authenticated !== true) {
        throw new Error("Not signed in");
      }
      await this.close();
      privateJson(join4(this.directory, "connected.json"), {
        connectedAt: Date.now()
      });
    } else if (action === "disconnect") {
      rmSync3(join4(this.directory, "connected.json"), { force: true });
      await this.close();
      rmSync3(join4(this.directory, "browser"), { force: true, recursive: true });
      rmSync3(join4(this.directory, "auth.json"), { force: true });
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
async function runWorker(directory, dataDir, orgId) {
  mkdirSync3(directory, { mode: 448, recursive: true });
  const store = new MeetingStore(dataDir, orgId);
  store.recover();
  const connection = new GoogleConnection(dataDir);
  const abort = new AbortController;
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let meetingActive = false;
  const token = crypto.randomUUID();
  const control = Bun.serve({
    async fetch(request) {
      if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response(null, { status: 404 });
      }
      const action = new URL(request.url).pathname.slice(1);
      if (!["connect", "connection", "finish-login", "disconnect"].includes(action)) {
        return new Response(null, { status: 404 });
      }
      try {
        if (abort.signal.aborted || action !== "connection" && meetingActive || action === "connect" && !connection.busy && store.next()) {
          throw new Error("Leave the active meeting before changing Google login");
        }
        return Response.json(await connection.command(action), {
          headers: { "Cache-Control": "no-store" }
        });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Login request failed"
        }, { status: 409 });
      }
    },
    hostname: "127.0.0.1",
    port: 0
  });
  privateJson(join4(directory, "control.json"), { port: control.port, token });
  const status = () => privateJson(join4(directory, "status.json"), {
    authenticated: connection.authenticated,
    loginBusy: connection.busy,
    state: abort.signal.aborted ? "stopped" : "ready",
    updatedAt: Date.now()
  });
  status();
  const heartbeat = setInterval(status, 3000);
  try {
    while (!abort.signal.aborted) {
      await connection.expire();
      const next = connection.busy ? undefined : store.next();
      if (next) {
        if (!connection.authenticated) {
          store.update(next.id, "failed", "Connect Google in Settings before joining");
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
    rmSync3(join4(directory, "control.json"), { force: true });
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
export {
  GoogleConnection,
  runMeeting
};
