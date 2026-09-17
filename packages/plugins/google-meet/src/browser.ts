import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser, type CookieData } from "puppeteer-core";
import { privateJson } from "./actions";

const browserPath = () =>
  process.env.NAKAMA_MEET_CHROME ??
  [
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);

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

function executablePath() {
  const path = browserPath();
  if (!path) {
    throw new Error(
      "Install Chromium or set NAKAMA_MEET_CHROME to its executable path"
    );
  }
  return path;
}

export async function authenticate(output: string) {
  const browser = await puppeteer.launch({
    executablePath: executablePath(),
    headless: false,
  });
  try {
    const page = await browser.newPage();
    await page.goto("https://accounts.google.com/", {
      waitUntil: "domcontentloaded",
    });
    console.log(
      "Sign into the meeting bot's Google account, then press Enter here."
    );
    for await (const _line of console) {
      break;
    }
    const cookies = (await browser.cookies()).filter((cookie) =>
      /(^|\.)google\.com$/.test(cookie.domain)
    );
    if (
      !cookies.some(
        (cookie) => cookie.name === "SID" || cookie.name === "__Secure-1PSID"
      )
    ) {
      throw new Error("No signed-in Google session found");
    }
    privateJson(output, cookies);
    console.log(
      "Saved Google login JSON. Import it in the Google Meet plugin settings."
    );
  } finally {
    await browser.close();
  }
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
  const chrome = executablePath();
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
  let browser: Browser | undefined;
  let recording:
    | ReturnType<typeof Bun.spawn<"ignore", "pipe", "ignore">>
    | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      recording?.kill("SIGTERM");
      const kill = setTimeout(() => {
        recording?.kill("SIGKILL");
        browser?.process()?.kill("SIGKILL");
      }, 2000);
      try {
        await browser?.close().catch(() => undefined);
        await recording?.exited;
      } finally {
        clearTimeout(kill);
        await command(["pactl", "unload-module", moduleId]).catch(
          () => undefined
        );
      }
    })();
    return closing;
  };
  const abort = () => {
    void close();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    options.signal.throwIfAborted();
    browser = await puppeteer.launch({
      args: [
        "--lang=en-US",
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--disable-dev-shm-usage",
      ],
      env: {
        HOME: process.env.HOME,
        LANG: "en_US.UTF-8",
        PATH: process.env.PATH,
        ...(process.env.PULSE_SERVER
          ? { PULSE_SERVER: process.env.PULSE_SERVER }
          : {}),
        ...(process.env.XDG_RUNTIME_DIR
          ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
          : {}),
        PULSE_SINK: sink,
      },
      executablePath: chrome,
      headless: true,
      // Puppeteer mutes audio by default. Capture needs real speaker output.
      ignoreDefaultArgs: ["--mute-audio"],
      signal: options.signal,
    });
    if (options.signal.aborted) {
      await browser.close();
      options.signal.throwIfAborted();
    }
    const cookies = JSON.parse(
      readFileSync(join(options.directory, "auth.json"), "utf8")
    ) as CookieData[];
    await browser.setCookie(...cookies);
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(options.url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    const deadline = Date.now() + 300_000;
    let admitted = false;
    let clicked = false;
    while (Date.now() < deadline) {
      options.signal.throwIfAborted();
      const state = await page.evaluate((shouldJoin) => {
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
      }, !clicked);
      if (state === "auth") {
        throw new Error(
          "Google login expired; import a new login JSON in plugin settings"
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
        if (!browser?.connected || page.isClosed()) {
          return false;
        }
        return await page.evaluate(() =>
          [...document.querySelectorAll("button")].some((button) =>
            /leave call/i.test(button.getAttribute("aria-label") ?? "")
          )
        );
      },
    };
  } catch (error) {
    options.signal.removeEventListener("abort", abort);
    await close();
    throw error;
  }
}
