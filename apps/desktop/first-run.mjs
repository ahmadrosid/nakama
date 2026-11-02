import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

// The first launch page: sign in to Nakama Cloud (the team's models), or use
// your own API keys. Electron objects come in as arguments, so the parts
// without a window run under `bun test`.

const CONFIG_FILE = "desktop.json";

const NAKAMA_CLOUD_URL = "https://withnakama.com";

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

/**
 * Signs this computer in through the local server: it returns the Connect
 * page address, the browser opens it, and the app waits for the status.
 */
export function createLocalSignIn({ dataDir, fetchImpl = fetch, serverUrl }) {
  const call = async (path, init = {}) => {
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

  return async ({ cloudUrl, openExternal, signal, wait = 1000 }) => {
    const { connectUrl } = await call("/v1/nakama-cloud/sign-in", {
      body: JSON.stringify({ cloudUrl, computerName: computerName() }),
      method: "POST",
    });

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

      const cloudUrl = normalizeCloudUrl(choice.url ?? NAKAMA_CLOUD_URL);
      await checkCloudServer(cloudUrl);

      waiting = new AbortController();

      try {
        await signIn({ cloudUrl, openExternal, signal: waiting.signal });
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
    void window.loadFile(join(import.meta.dirname, "first-run.html"));
  });
}
