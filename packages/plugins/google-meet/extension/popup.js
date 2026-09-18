/* global chrome */

const chrome = globalThis.chrome;
const status = document.querySelector("#status");
const connect = document.querySelector("#connect");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
let busy = false;

async function refresh() {
  const [state, tabs] = await Promise.all([
    chrome.runtime.sendMessage({ type: "STATE" }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const url = new URL(tabs[0]?.url || "about:blank");
  const recording = ["starting", "recording"].includes(
    state?.captureSession?.status
  );
  const connected = Boolean(state?.connection);
  const onMeet =
    url.origin === "https://meet.google.com" &&
    /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname);
  const badge = document.querySelector("#connection");
  badge.textContent = connected ? "✓ Connected" : "Not connected";
  badge.dataset.connected = String(connected);
  document.querySelector("#meeting").textContent = recording
    ? "Transcribing your meeting"
    : connected && onMeet
      ? "Ready to transcribe"
      : connected
        ? "Waiting for a meeting"
        : "Connect to get started";
  document.querySelector("#connect-step").textContent = connected ? "✓" : "1";
  document.querySelector("#connect-step").dataset.done = String(connected);
  document.querySelector("#connect-label").textContent = connected
    ? "Nakama connected"
    : "Connect Nakama";
  document.querySelector("#meet-step").textContent =
    recording || onMeet ? "✓" : "2";
  document.querySelector("#meet-step").dataset.done = String(
    recording || onMeet
  );
  document.querySelector("#meet-label").textContent =
    recording || onMeet ? "Google Meet open" : "Open Google Meet";
  connect.hidden = connected || url.pathname !== "/plugins/google-meet";
  connect.disabled = busy || recording;
  start.hidden = !(connected && onMeet) || recording;
  start.disabled = busy || recording || !state?.connection || !onMeet;
  stop.hidden = !recording;
  stop.disabled = busy || !recording;
  status.textContent =
    state?.captureSession?.error ||
    (recording
      ? "Keep Nakama open while transcribing."
      : connected
        ? onMeet
          ? "Keep Nakama open while transcribing."
          : "Open the extension in your Meet tab. Keep Nakama open."
        : "Open Google Meet in Nakama, then connect here.");
}

async function run(type) {
  busy = true;
  connect.disabled = start.disabled = stop.disabled = true;
  status.textContent =
    type === "START"
      ? "Starting transcription…"
      : type === "STOP"
        ? "Stopping transcription…"
        : "Connecting…";
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (result?.error) {
      throw new Error(result.error);
    }
    busy = false;
    await refresh();
  } catch (error) {
    busy = false;
    await refresh().catch(() => undefined);
    status.textContent = error.message;
  }
}
connect.onclick = () => run("CONNECT");
start.onclick = () => run("START");
stop.onclick = () => run("STOP");
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "session" &&
    (changes.captureSession || changes.connection) &&
    !busy
  ) {
    refresh().catch((error) => {
      status.textContent = error.message;
    });
  }
});
refresh().catch((error) => {
  status.textContent = error.message;
});
