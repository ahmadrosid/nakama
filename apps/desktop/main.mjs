import { join } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";

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
      sandbox: true,
    },
    width: 1200,
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
      .then(() => createWindow(serverUrl(process.env.NAKAMA_DESKTOP_URL)))
      .catch((error) => {
        dialog.showErrorBox("Cannot open Nakama", error.message);
        app.quit();
      });
    app.on("window-all-closed", () => app.quit());
  } else {
    app.quit();
  }
}
