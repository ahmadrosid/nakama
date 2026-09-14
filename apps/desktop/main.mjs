import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from "electron";

export function configureUpdates(
  updater,
  stopServer,
  prompt = dialog.showMessageBox
) {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  let installing = false;
  const updateFailed = (error) => {
    console.warn("Desktop update failed:", error.message);
    if (installing) {
      dialog.showErrorBox(
        "Could not install update",
        "Reopen Nakama to try again."
      );
      app.quit();
    }
  };
  const check = async (manual = false) => {
    const item =
      Menu.getApplicationMenu()?.getMenuItemById("check-for-updates");
    if (manual && item) {
      item.enabled = false;
      item.label = "Checking for Updates…";
    }
    try {
      const result = await updater.checkForUpdates();
      if (manual) {
        await prompt({
          detail: result?.isUpdateAvailable
            ? "You’ll be asked to restart when the update is ready."
            : undefined,
          message: result?.isUpdateAvailable
            ? `Downloading Nakama ${result.updateInfo.version}`
            : result
              ? "Nakama is up to date"
              : "Updates are unavailable in this build",
          type: "info",
        });
      }
    } catch (error) {
      console.warn("Update check failed:", error.message);
      if (manual) {
        await prompt({
          detail: "Check your internet connection and try again.",
          message: "Could not check for updates",
          type: "error",
        });
      }
    } finally {
      if (manual && item) {
        item.enabled = true;
        item.label = "Check for Updates…";
      }
    }
  };
  const updateItem = {
    click: () => void check(true),
    id: "check-for-updates",
    label: "Check for Updates…",
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" },
                updateItem,
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      ...(process.platform === "darwin"
        ? []
        : [{ role: "help", submenu: [updateItem] }]),
    ])
  );
  updater.on("error", updateFailed);
  updater.on("update-downloaded", async ({ version }) => {
    try {
      const { response } = await prompt({
        buttons: ["Restart now", "Later"],
        cancelId: 1,
        defaultId: 1,
        detail:
          "Restarting stops running local tasks. Your saved data is kept.",
        message: `Nakama ${version} is ready to install`,
        type: "info",
      });
      if (response === 0 && (await stopServer())) {
        installing = true;
        updater.quitAndInstall();
      }
    } catch (error) {
      updateFailed(error);
    }
  });
  check();
  const timer = setInterval(check, 6 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function startLocalServer(runtime, dataDir) {
  await mkdir(dataDir, { mode: 0o700, recursive: true });
  const log = await open(join(dataDir, "server.log"), "w", 0o600);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("NAKAMA_"))
  );
  const child = spawn(
    join(runtime, "bin/bun"),
    ["run", "apps/server/src/index.ts"],
    {
      cwd: runtime,
      env: {
        ...env,
        BUN_INSTALL_BIN: join(dataDir, "bin"),
        BUN_INSTALL_GLOBAL_DIR: join(dataDir, "bun/install/global"),
        DATABASE_URL: `file:${join(dataDir, "sqlite/nakama.sqlite")}`,
        NAKAMA_CONFIG_DIR: dataDir,
        NAKAMA_DESKTOP: "1",
        NAKAMA_DISABLE_FIX_PATH: "1",
        NAKAMA_HOST: "127.0.0.1",
        NAKAMA_PORT: "0",
        NODE_ENV: "production",
        PATH: `${join(runtime, "bin")}${delimiter}${process.env.PATH ?? ""}`,
        PM2_HOME: join(dataDir, "pm2"),
      },
      serialization: "json",
      stdio: ["ignore", log.fd, log.fd, "ipc"],
    }
  );
  void log.close();
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("Local server startup timed out")),
        60_000
      );
      const onExit = () =>
        finish(new Error("Local server exited during startup"));
      const onError = (error) => finish(error);
      const onMessage = (message) => {
        if (message?.type === "nakama-ready") {
          finish(null, message.url);
        }
      };
      function finish(error, value) {
        clearTimeout(timeout);
        child.off("exit", onExit);
        child.off("error", onError);
        child.off("message", onMessage);
        if (error) {
          reject(error);
        } else {
          try {
            resolve(serverUrl(value));
          } catch (invalidUrl) {
            reject(invalidUrl);
          }
        }
      }
      child.once("exit", onExit);
      child.once("error", onError);
      child.on("message", onMessage);
    });
    return { child, stop, url: url.replace(/\/$/, "") };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}. See ${join(dataDir, "server.log")}`);
  }
}

export function serverUrl(value = "http://localhost:4310/chat") {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    throw new Error(
      "Use HTTPS, or HTTP on localhost, without embedded credentials."
    );
  }
  return url.href;
}

function openInBrowser(value) {
  const url = new URL(value);
  if (
    ["https:", "http:"].includes(url.protocol) &&
    !url.username &&
    !url.password
  ) {
    void shell.openExternal(url.href).catch(() => undefined);
  }
}

export async function createWindow(url, { show = true } = {}) {
  const origin = new URL(serverUrl(url)).origin;
  const window = new BrowserWindow({
    backgroundColor: "#09090b",
    height: 800,
    minHeight: 540,
    minWidth: 720,
    show,
    title: "Nakama",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
    },
    width: 1200,
  });
  window.webContents.ipc.on("nakama:theme", (event, theme) => {
    if (
      event.senderFrame === window.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === origin &&
      ["light", "dark", "system"].includes(theme)
    ) {
      nativeTheme.themeSource = theme;
    }
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openInBrowser(target);
    return { action: "deny" };
  });
  const guardNavigation = (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      openInBrowser(target);
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault()
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const sameServer =
        details.requestingUrl &&
        new URL(details.requestingUrl).origin === origin &&
        new URL(contents.getURL()).origin === origin;
      callback(
        Boolean(sameServer && permission === "clipboard-sanitized-write")
      );
    }
  );
  while (!window.isDestroyed()) {
    try {
      await window.loadURL(url);
      break;
    } catch {
      if (window.isDestroyed()) {
        break;
      }
      const { response } = await dialog.showMessageBox(window, {
        buttons: ["Retry", "Close"],
        cancelId: 1,
        defaultId: 0,
        detail: `Start your Nakama server, then retry.\n${url}`,
        message: "Cannot connect to Nakama",
        type: "error",
      });
      if (response !== 0) {
        window.close();
        break;
      }
    }
  }
  return window;
}

if (!process.argv.includes("--smoke-test")) {
  let localServer;
  let quitting = false;
  app.setName("Nakama");
  app.setPath(
    "userData",
    join(app.getPath("appData"), "Nakama Desktop Electron")
  );
  if (app.requestSingleInstanceLock()) {
    app.on("second-instance", () => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window?.isMinimized()) {
        window.restore();
      }
      window?.show();
      window?.focus();
    });
    app
      .whenReady()
      .then(async () => {
        if (process.env.NAKAMA_DESKTOP_URL) {
          return createWindow(serverUrl(process.env.NAKAMA_DESKTOP_URL));
        }
        localServer = await startLocalServer(
          app.isPackaged
            ? join(process.resourcesPath, "runtime")
            : join(app.getAppPath(), "dist/runtime"),
          join(app.getPath("userData"), "server")
        );
        if (quitting) {
          await localServer.stop();
          app.exit();
          return;
        }
        localServer.child.once("exit", () => {
          if (!quitting) {
            dialog.showErrorBox(
              "Nakama server stopped",
              "Reopen Nakama to restart the local server."
            );
            app.quit();
          }
        });
        return createWindow(`${localServer.url}/chat`);
      })
      .then(async () => {
        if (app.isPackaged && !quitting) {
          const { autoUpdater } = (await import("electron-updater")).default;
          configureUpdates(autoUpdater, async () => {
            if (quitting) {
              return false;
            }
            quitting = true;
            await localServer?.stop();
            localServer = undefined;
            return true;
          });
        }
      })
      .catch((error) => {
        dialog.showErrorBox("Cannot open Nakama", error.message);
        app.quit();
      });
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) => {
      quitting = true;
      if (localServer) {
        event.preventDefault();
        void localServer.stop().finally(() => app.exit());
      }
    });
  } else {
    app.quit();
  }
}
