import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { createWindow, serverUrl } from "../main.mjs";

const timeout = setTimeout(() => {
  console.error("Smoke test timed out");
  app.exit(1);
}, 20_000);
async function run() {
  app.setPath("userData", await mkdtemp(join(tmpdir(), "nakama-wrapper-")));
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
  server.close();
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
