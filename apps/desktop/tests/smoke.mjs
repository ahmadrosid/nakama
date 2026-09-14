import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, Menu, nativeTheme } from "electron";
import {
  configureUpdates,
  createWindow,
  serverUrl,
  startLocalServer,
} from "../main.mjs";

app.on("window-all-closed", () => {});

const timeout = setTimeout(
  () => {
    console.error("Smoke test timed out");
    app.exit(1);
  },
  process.argv.includes("--runtime-test") ? 120_000 : 20_000
);
async function run() {
  app.setPath("userData", await mkdtemp(join(tmpdir(), "nakama-wrapper-")));
  await app.whenReady();
  const updater = new EventEmitter();
  let checks = 0;
  let choice = 1;
  const order = [];
  let finishStop;
  let checkError;
  let updateAvailable = false;
  const prompts = [];
  updater.checkForUpdates = async () => {
    checks += 1;
    if (checkError) {
      throw checkError;
    }
    return {
      isUpdateAvailable: updateAvailable,
      updateInfo: { version: "0.2.0" },
    };
  };
  updater.quitAndInstall = () => order.push("install");
  const cancelUpdates = configureUpdates(
    updater,
    async () => {
      order.push("stop");
      await new Promise((resolve) => {
        finishStop = resolve;
      });
      return true;
    },
    async (options) => {
      prompts.push(options);
      return { response: choice };
    }
  );
  assert.equal(checks, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prompts.length, 0);
  const updateItem =
    Menu.getApplicationMenu().getMenuItemById("check-for-updates");
  assert.ok(updateItem);
  updateItem.click();
  assert.equal(updateItem.enabled, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 2);
  assert.equal(prompts.at(-1).message, "Nakama is up to date");
  assert.equal(updateItem.enabled, true);
  updateAvailable = true;
  updateItem.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(prompts.at(-1).message, /0\.2\.0/);
  checkError = new Error("Network unavailable");
  updateItem.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prompts.at(-1).type, "error");
  assert.equal(updateItem.enabled, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  choice = 0;
  updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["stop"]);
  finishStop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["stop", "install"]);
  cancelUpdates();
  if (process.argv.includes("--updates-test")) {
    clearTimeout(timeout);
    console.log(
      "Passed: update menu, manual checks, failure recovery, and restart installation."
    );
    app.exit(0);
    return;
  }
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://remote.example",
    "https://user:secret@example.com",
  ]) {
    assert.throws(() => serverUrl(value));
  }
  assert.equal(serverUrl(), "http://localhost:4310/chat");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.setHeader(
      "Set-Cookie",
      "session=test-only; HttpOnly; SameSite=Lax; Path=/"
    );
    response.end(
      '<!doctype html><title>Nakama fixture</title><h1>Existing web app</h1><input type="file"><textarea aria-label="Message"></textarea>'
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await app.whenReady();
  const url = `http://127.0.0.1:${server.address().port}/chat`;
  const window = await createWindow(url, { show: false });
  assert.equal(window.webContents.getURL(), url);
  assert.equal(
    await window.webContents.executeJavaScript(
      "document.querySelector('h1').textContent"
    ),
    "Existing web app"
  );
  assert.equal(
    await window.webContents.executeJavaScript(
      "typeof require + ':' + typeof process + ':' + typeof window.nakama"
    ),
    "undefined:undefined:undefined"
  );
  await window.webContents.executeJavaScript(
    "localStorage.setItem('test', 'saved')"
  );
  await window.loadURL(url);
  for (const theme of ["dark", "system", "light", "system", "dark"]) {
    await window.webContents.executeJavaScript(
      `localStorage.setItem('nakama-theme', '${theme}'); document.documentElement.dataset.theme = '${theme}'`
    );
    const deadline = Date.now() + 2000;
    while (nativeTheme.themeSource !== theme && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(nativeTheme.themeSource, theme);
  }
  await window.reload();
  await new Promise((resolve) =>
    window.webContents.once("did-finish-load", resolve)
  );
  assert.equal(nativeTheme.themeSource, "dark");
  assert.equal(
    await window.webContents.executeJavaScript("localStorage.getItem('test')"),
    "saved"
  );
  assert.equal(
    await window.webContents.executeJavaScript("document.cookie"),
    ""
  );
  assert.equal(
    (await window.webContents.session.cookies.get({ url }))[0].value,
    "test-only"
  );
  window.destroy();
  nativeTheme.themeSource = "system";
  server.close();
  if (process.argv.includes("--runtime-test")) {
    const data = await mkdtemp(join(tmpdir(), "nakama-server-test-"));
    const runtime =
      process.env.NAKAMA_DESKTOP_TEST_RUNTIME ??
      join(import.meta.dirname, "../dist/runtime");
    await assert.rejects(startLocalServer(join(data, "missing"), data));
    const previousPath = process.env.PATH;
    process.env.PATH =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32")
        : "/usr/bin:/bin";
    let local;
    try {
      local = await startLocalServer(runtime, data);
      assert.equal(
        (await (await fetch(`${local.url}/health`)).json()).ok,
        true
      );
      assert.match(await (await fetch(`${local.url}/chat`)).text(), /<html/);
      const setup = await fetch(`${local.url}/v1/auth/setup`, {
        body: JSON.stringify({
          admin: {
            email: "desktop@example.test",
            name: "Test",
            password: "test-password-123",
          },
          organization: { name: "Desktop Test", slug: "desktop-test" },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(setup.ok, true);
      await local.stop();
      await assert.rejects(fetch(`${local.url}/health`));
      local = await startLocalServer(runtime, data);
      const login = await fetch(`${local.url}/v1/auth/login`, {
        body: JSON.stringify({
          email: "desktop@example.test",
          password: "test-password-123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(login.ok, true);
      const worker = await promisify(execFile)(
        join(runtime, "bin", process.platform === "win32" ? "bun.exe" : "bun"),
        [
          "-e",
          `
        const { default: pm2 } = await import('pm2');
        pm2.connect(error => {
          if (error) process.exit(1);
          pm2.start({ name: 'desktop-smoke-worker', script: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)'], interpreter: 'none' }, (failure, processes) => {
            if (failure) process.exit(1);
            console.log('WORKER_PID=' + processes[0].pid);
            pm2.disconnect();
            process.exit(0);
          });
        });
      `,
        ],
        {
          cwd: join(runtime, "apps/server"),
          env: { ...process.env, PM2_HOME: join(data, "pm2") },
          timeout: 15_000,
        }
      );
      const workerPid = Number(worker.stdout.match(/WORKER_PID=(\d+)/)?.[1]);
      assert.ok(workerPid > 0);
      const pm2Pid = await readFile(join(data, "pm2/pm2.pid"), "utf8").catch(
        () => null
      );
      const exited = new Promise((resolve) =>
        local.child.once("exit", resolve)
      );
      local.child.disconnect();
      await exited;
      await assert.rejects(fetch(`${local.url}/health`));
      // PM2 acknowledges daemon shutdown before its process finishes exiting.
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (pm2Pid) {
        assert.throws(() => process.kill(Number(pm2Pid.trim()), 0));
      }
      assert.throws(() => process.kill(workerPid, 0));
      console.log(
        "Passed: bundled runtime, first setup, persistent account, shutdown, and parent disconnect cleanup."
      );
    } finally {
      process.env.PATH = previousPath;
      await local?.stop();
    }
  }
  clearTimeout(timeout);
  console.log(
    "Passed: existing page loads, renderer has no native bridge, HTTP-only session cookies and browser storage work."
  );
  app.exit(0);
}
run().catch((error) => {
  console.error(error);
  clearTimeout(timeout);
  app.exit(1);
});
