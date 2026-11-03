import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

// The first launch page: sign in to Nakama Cloud (the team's models), or use
// your own API keys. Electron objects come in as arguments, so the parts
// without a window run under `bun test`.

const CONFIG_FILE = "desktop.json";

const NAKAMA_CLOUD_URL = "https://withnakama.com";

/** The "Sign in to Nakama" server. NAKAMA_CLOUD_URL points it at a test or staging cloud. */
export function defaultCloudUrl(env = process.env) {
  return normalizeCloudUrl(env.NAKAMA_CLOUD_URL || NAKAMA_CLOUD_URL);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** How long the app waits for the browser to finish Connect. */
const SIGN_IN_WAIT_MS = 10 * 60 * 1000;

export function normalizeCloudUrl(value) {
  let url;

  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("Enter a full address, such as https://withnakama.com.");
  }

  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    )
  ) {
    throw new Error("Use HTTPS, or HTTP on localhost.");
  }

  return url.origin;
}

/** A Nakama server answers its public /health route with an apiVersion. */
export async function checkCloudServer(origin, fetchImpl = fetch) {
  let body = null;

  try {
    const response = await fetchImpl(`${origin}/health`, {
      signal: AbortSignal.timeout(8000),
    });

    body = response.ok ? await response.json() : null;
  } catch {
    body = null;
  }

  if (!Number.isInteger(body?.apiVersion)) {
    throw new Error("No Nakama server at this address.");
  }
}

export async function readDesktopConfig(userDataDir) {
  try {
    const raw = JSON.parse(
      await readFile(join(userDataDir, CONFIG_FILE), "utf8")
    );

    if (raw.choice === "cloud" || raw.choice === "local") {
      return { choice: raw.choice };
    }
  } catch {
    // Missing or broken: ask again on the first launch page.
  }

  return null;
}

export async function writeDesktopConfig(userDataDir, config) {
  await mkdir(userDataDir, { mode: 0o700, recursive: true });
  await writeFile(
    join(userDataDir, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 }
  );
}

export async function clearDesktopConfig(userDataDir) {
  await rm(join(userDataDir, CONFIG_FILE), { force: true });
}

/**
 * Calls onSignOut when the chat page signs out of Nakama Cloud, so the app
 * can ask again instead of moving to another provider without a word.
 */
export function watchCloudSignOut(session, serverUrl, onSignOut) {
  const signOutUrl = `${serverUrl}/v1/nakama-cloud`;

  session.webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
    if (
      details.method === "DELETE" &&
      details.url === signOutUrl &&
      details.statusCode >= 200 &&
      details.statusCode < 300
    ) {
      onSignOut();
    }
  });
}

/** On macOS, hostname() can be an IP address; use the Computer Name. */
function computerName() {
  try {
    const name =
      process.platform === "darwin"
        ? execFileSync("scutil", ["--get", "ComputerName"], {
            encoding: "utf8",
          })
        : hostname();

    return name.trim().slice(0, 100) || "This computer";
  } catch {
    return hostname().replace(/\.local$/i, "") || "This computer";
  }
}

/** Calls the local server with this computer's local token (a 0600 file). */
function localApi({ dataDir, fetchImpl, serverUrl }) {
  return async (path, init = {}) => {
    const token = (
      await readFile(join(dataDir, "local-auth-token"), "utf8")
    ).trim();

    const response = await fetchImpl(`${serverUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(body?.error ?? "Sign-in did not start.");
    }

    return body;
  };
}

/**
 * The choice an install made before the first launch page existed: one with
 * providers already set up keeps them. Null when there are none, or the
 * check fails, so the page asks.
 */
export async function existingChoice({
  dataDir,
  fetchImpl = fetch,
  serverUrl,
}) {
  try {
    const { providers } = await localApi({ dataDir, fetchImpl, serverUrl })(
      "/v1/providers"
    );

    if (!(Array.isArray(providers) && providers.length > 0)) {
      return null;
    }

    return {
      choice: providers.some((provider) => provider.type === "nakama_cloud")
        ? "cloud"
        : "local",
    };
  } catch {
    return null;
  }
}

/**
 * First launch: sign in to Nakama Cloud, or use your own API keys. An
 * install from before this page keeps the providers it has.
 */
export async function ensureDesktopChoice({
  dataDir,
  fetchImpl = fetch,
  firstRun,
  serverUrl,
  userDataDir,
}) {
  if (await readDesktopConfig(userDataDir)) {
    return;
  }

  const kept = await existingChoice({ dataDir, fetchImpl, serverUrl });

  await (kept ? writeDesktopConfig(userDataDir, kept) : firstRun());
}

/**
 * Signs this computer in through the local server: it returns the Connect
 * page address, the browser opens it, and the app waits for the status.
 */
export function createLocalSignIn({ dataDir, fetchImpl = fetch, serverUrl }) {
  const call = localApi({ dataDir, fetchImpl, serverUrl });

  return async ({ cloudUrl, onCode, openExternal, signal, wait = 1000 }) => {
    // A new choice replaces an old account, so "signed in" below is this one.
    await call("/v1/nakama-cloud", { method: "DELETE" });

    const { code, connectUrl } = await call("/v1/nakama-cloud/sign-in", {
      body: JSON.stringify({ cloudUrl, computerName: computerName() }),
      method: "POST",
    });

    try {
      // The Connect page shows the same code, so a link from someone else
      // stands out.
      onCode?.(code);
      await openExternal(connectUrl);
      const deadline = Date.now() + SIGN_IN_WAIT_MS;

      while (Date.now() < deadline) {
        if (signal?.aborted) {
          throw new Error("first-run-cancelled");
        }

        if ((await call("/v1/nakama-cloud")).signedIn) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      throw new Error("Sign-in took too long. Try again.");
    } catch (error) {
      // Close the sign-in, so a Connect in the browser later does nothing.
      await call("/v1/nakama-cloud", { method: "DELETE" }).catch(() => null);
      throw error;
    }
  };
}

/** The first launch page. Resolves with the saved choice. */
export function runFirstRun({
  BrowserWindow,
  ipcMain,
  openExternal,
  preload,
  signIn,
  userDataDir,
}) {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      height: 560,
      resizable: false,
      title: "Nakama",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload,
        sandbox: true,
      },
      width: 520,
    });

    let chosen = false;
    let waiting = null;

    const fromPage = (event) => event.sender === window.webContents;

    const finish = async (config) => {
      await writeDesktopConfig(userDataDir, config);
      chosen = true;
      ipcMain.removeHandler("nakama:first-run");
      ipcMain.removeHandler("nakama:first-run-cancel");
      window.close();
      resolve(config);
    };

    ipcMain.handle("nakama:first-run", async (event, choice) => {
      if (!fromPage(event)) {
        throw new Error("Not allowed.");
      }

      if (choice?.mode !== "cloud") {
        await finish({ choice: "local" });

        return;
      }

      const cloudUrl = choice.url
        ? normalizeCloudUrl(choice.url)
        : defaultCloudUrl();

      await checkCloudServer(cloudUrl);

      waiting = new AbortController();

      try {
        await signIn({
          cloudUrl,
          onCode: (code) =>
            window.webContents.send("nakama:first-run-code", code),
          openExternal,
          signal: waiting.signal,
        });
      } finally {
        waiting = null;
      }

      await finish({ choice: "cloud" });
    });

    ipcMain.handle("nakama:first-run-cancel", (event) => {
      if (fromPage(event)) {
        waiting?.abort();
      }
    });

    window.on("closed", () => {
      waiting?.abort();

      if (!chosen) {
        ipcMain.removeHandler("nakama:first-run");
        ipcMain.removeHandler("nakama:first-run-cancel");
        reject(new Error("first-run-closed"));
      }
    });

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    let cloud = "";

    try {
      cloud = defaultCloudUrl();
    } catch {
      // A bad NAKAMA_CLOUD_URL shows its error when the card is pressed.
    }

    void window.loadFile(join(import.meta.dirname, "first-run.html"), {
      query: { cloud },
    });
  });
}
