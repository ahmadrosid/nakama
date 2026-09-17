import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BetterWright, BetterWrightOptions } from "betterwright";

export class BrowserSetupError extends Error {}

function installedRuntime() {
  const configDir = process.env.NAKAMA_PLUGIN_WORKER_ROOT;
  return configDir ? join(configDir, "runtimes", "google-meet") : undefined;
}

function installedBrowser() {
  const root = installedRuntime();
  if (!root) {
    return;
  }
  try {
    const saved = JSON.parse(readFileSync(join(root, "browser.json"), "utf8"));
    return typeof saved.path === "string" && existsSync(saved.path)
      ? (saved.path as string)
      : undefined;
  } catch {}
}

function browserOptions(directory: string): BetterWrightOptions {
  const managedBrowser =
    process.env.BETTERWRIGHT_CHROMIUM_PATH ||
    process.env.BETTERWRIGHT_CHROMIUM_ROOT;
  const executablePath =
    process.env.NAKAMA_MEET_CHROME ||
    installedBrowser() ||
    (managedBrowser
      ? undefined
      : [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/usr/bin/chromium",
          "/usr/bin/google-chrome",
        ].find(existsSync));
  return {
    adBlock: false,
    chromiumArgs: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
    ],
    credentialCapture: false,
    downloadPolicy: "deny",
    // Playwright adds --mute-audio in headless mode. Xvfb supplies the display
    // on Linux; BetterWright's live view provides remote human interaction.
    headless: false,
    home: join(directory, "browser"),
    locale: "en-US",
    parkBackgroundPages: false,
    ...(executablePath ? { provider: { executablePath } } : {}),
    vault: false,
  };
}

export function viewerUrl(localUrl: string, origin?: string) {
  if (!origin) {
    return localUrl;
  }
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BrowserSetupError(
      "Viewer origin must be an HTTPS origin without a path"
    );
  }
  url.search = new URL(localUrl).search;
  return url.href;
}

async function command(args: string[]) {
  const child = Bun.spawn(args, {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) {
      throw new Error(
        `${args[0]} failed; check the Google Meet worker prerequisites`
      );
    }
    return output.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function openBrowser(directory: string) {
  const options = browserOptions(directory);
  mkdirSync(options.home!, { mode: 0o700, recursive: true });
  let display:
    | ReturnType<typeof Bun.spawn<"ignore", "pipe", "ignore">>
    | undefined;
  const previousDisplay = process.env.DISPLAY;
  let browser: BetterWright | undefined;
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
        throw new BrowserSetupError(
          "Install Xvfb for the BetterWright browser on Linux"
        );
      }
      display = Bun.spawn(
        [
          "Xvfb",
          "-displayfd",
          "1",
          "-terminate",
          "-screen",
          "0",
          "1280x900x24",
          "-nolisten",
          "tcp",
        ],
        { stderr: "ignore", stdin: "ignore", stdout: "pipe" }
      );
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
    const defaultRuntime =
      "/opt/nakama-meet/node_modules/betterwright/dist/src/index.js";
    const root = installedRuntime();
    const downloadedRuntime = root
      ? join(
          root,
          "sdk-2.8.1-0.5.10/node_modules/betterwright/dist/src/index.js"
        )
      : undefined;
    const modulePath =
      runtime ||
      (downloadedRuntime && existsSync(downloadedRuntime)
        ? downloadedRuntime
        : undefined) ||
      (existsSync(defaultRuntime) ? defaultRuntime : undefined);
    // Keep the SDK external: it spawns sibling worker.js and reads package assets.
    const sdk = await import(
      modulePath ? pathToFileURL(modulePath).href : "betterwright"
    );
    browser = new sdk.BetterWright(options);
    return { browser: browser!, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function runBrowser<T>(
  browser: BetterWright,
  code: string,
  signal?: AbortSignal
): Promise<T> {
  const result = await browser.run<T>(code, {
    automaticUI: false,
    signal,
    timeout: 30,
  });
  if (!result.ok) {
    if (
      result.error?.includes("BetterChromium is required but not installed")
    ) {
      throw new BrowserSetupError(
        "Install Chrome/Chromium, set NAKAMA_MEET_CHROME, or run betterwright setup to install BetterChromium."
      );
    }
    throw new Error("Google Meet browser operation failed");
  }
  return result.result as T;
}

function meetState(shouldJoin: boolean) {
  const text = document.body.innerText;
  if (location.hostname === "accounts.google.com") {
    return "auth";
  }
  if (
    /You can't join|You were removed|No one responded|You couldn't join/i.test(
      text
    )
  ) {
    return "denied";
  }
  const buttons = [...document.querySelectorAll("button")];
  if (
    buttons.some((button) =>
      /leave call/i.test(button.getAttribute("aria-label") ?? "")
    )
  ) {
    return "admitted";
  }
  if (shouldJoin) {
    let mutedControls = false;
    for (const button of buttons) {
      if (
        /turn off (microphone|camera)/i.test(
          button.getAttribute("aria-label") ?? ""
        )
      ) {
        button.click();
        mutedControls = true;
      }
    }
    if (mutedControls) {
      return "waiting";
    }
    // Refuse admission until both controls confirm they are disabled.
    if (
      !["microphone", "camera"].every((device) =>
        buttons.some((button) =>
          (button.getAttribute("aria-label") ?? "")
            .toLowerCase()
            .includes(`turn on ${device}`)
        )
      )
    ) {
      return "waiting";
    }
    const join = buttons.find((button) =>
      /^(Join now|Ask to join)$/.test(button.innerText.trim())
    );
    if (join) {
      join.click();
      return "clicked";
    }
  }
  return "waiting";
}

export async function captureMeeting(options: {
  id: string;
  url: string;
  directory: string;
  signal: AbortSignal;
}) {
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
    "channels=2",
  ]);
  const previousSink = process.env.PULSE_SINK;
  process.env.PULSE_SINK = sink;
  let instance: Awaited<ReturnType<typeof openBrowser>> | undefined;
  let recording:
    | ReturnType<typeof Bun.spawn<"ignore", "pipe", "ignore">>
    | undefined;
  let closing: Promise<void> | undefined;
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
        await command(["pactl", "unload-module", moduleId]).catch(
          () => undefined
        );
      }
    })();
    return closing;
  };
  const abort = () => {
    void close().catch(() => undefined);
  };
  try {
    options.signal.throwIfAborted();
    instance = await openBrowser(options.directory);
    options.signal.throwIfAborted();
    options.signal.addEventListener("abort", abort, { once: true });
    const browser = instance.browser;
    await runBrowser(
      browser,
      `await page.goto(${JSON.stringify(options.url)}, { waitUntil: "domcontentloaded" });`,
      options.signal
    );
    const deadline = Date.now() + 300_000;
    let admitted = false;
    let clicked = false;
    while (Date.now() < deadline) {
      options.signal.throwIfAborted();
      const state = await runBrowser<string>(
        browser,
        `return await page.evaluate(${meetState.toString()}, ${!clicked});`,
        options.signal
      );
      if (state === "auth") {
        rmSync(join(options.directory, "connected.json"), { force: true });
        throw new Error(
          "Google login expired; reconnect in Google Meet settings"
        );
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
    recording = Bun.spawn(
      [
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
        "pipe:1",
      ],
      { stderr: "ignore", stdin: "ignore", stdout: "pipe" }
    );
    return {
      audio: recording.stdout,
      async close() {
        options.signal.removeEventListener("abort", abort);
        await close();
      },
      async inCall() {
        return (
          (await runBrowser<string>(
            browser,
            `return await page.evaluate(${meetState.toString()}, false);`,
            options.signal
          )) === "admitted"
        );
      },
    };
  } catch (error) {
    options.signal.removeEventListener("abort", abort);
    await close();
    throw error;
  }
}
