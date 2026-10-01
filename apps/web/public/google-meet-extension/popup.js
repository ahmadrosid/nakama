/* global chrome */

const chrome = globalThis.chrome;
const status = document.querySelector("#status");
const connect = document.querySelector("#connect");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const openSidePanel = document.querySelector("#open-side-panel");
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
  connect.hidden = url.pathname !== "/plugins/google-meet" || recording;
  connect.textContent = connected
    ? "Reconnect this Nakama tab"
    : "Connect this Nakama tab";
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
openSidePanel.onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      throw new Error("Open the Google Meet tab first.");
    }
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    status.textContent = error.message;
  }
};
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

const transcript = document.querySelector("#transcript");
const fullTranscript = document.querySelector("#full-transcript");
let transcriptMeeting;
let cursor = 0;
let transcriptRunning = false;
let visible = true;
let generation = 0;
let terminal = false;
const turnIds = new Set();
function resetTranscript() {
  generation++;
  transcriptMeeting = undefined;
  cursor = 0;
  terminal = false;
  turnIds.clear();
  transcript.replaceChildren();
  fullTranscript.hidden = true;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "session" &&
    (changes.connection ||
      changes.captureSession?.newValue?.meetingId !==
        changes.captureSession?.oldValue?.meetingId)
  ) {
    resetTranscript();
    void refreshTranscript();
  }
});
async function refreshTranscript() {
  if (!visible || transcriptRunning || terminal) {
    return;
  }
  transcriptRunning = true;
  const requestGeneration = generation;
  try {
    const result = await chrome.runtime.sendMessage({
      after: cursor,
      type: "TRANSCRIPT",
    });
    if (!visible || requestGeneration !== generation) {
      return;
    }
    if (result?.error) {
      throw new Error(result.error);
    }
    if (!result) {
      resetTranscript();
      return;
    }
    if (result.meeting.id !== transcriptMeeting) {
      const hadCursor = cursor > 0;
      resetTranscript();
      transcriptMeeting = result.meeting.id;
      if (hadCursor) {
        return;
      }
    }
    fullTranscript.hidden = false;
    const atBottom =
      transcript.scrollTop + transcript.clientHeight >=
      transcript.scrollHeight - 24;
    for (const segment of result.segments) {
      if (turnIds.has(segment.id)) {
        continue;
      }
      turnIds.add(segment.id);
      const turn = document.createElement("p");
      turn.dataset.id = segment.id;
      const label = document.createElement("strong");
      label.textContent = segment.speakerName || "Unknown speaker";
      turn.append(label, document.createTextNode(`\n${segment.text}`));
      transcript.append(turn);
    }
    while (transcript.children.length > 200) {
      turnIds.delete(transcript.firstElementChild.dataset.id);
      transcript.firstElementChild.remove();
    }
    cursor = result.nextCursor;
    terminal =
      ["finished", "failed"].includes(result.meeting.state) &&
      result.segments.length === 0;
    if (atBottom) {
      transcript.scrollTop = transcript.scrollHeight;
    }
    if (result.meeting.error) {
      status.textContent = result.meeting.error;
    } else if (result.meeting.pendingSeconds > 30) {
      status.textContent = "Transcription is catching up…";
    } else if (result.meeting.state === "transcribing") {
      status.textContent = "Finishing transcript…";
    } else if (result.meeting.state === "finished") {
      status.textContent = "Transcript ready";
    } else if (!cursor) {
      status.textContent = "Waiting for the first transcript…";
    }
    if (result.segments.length) {
      setTimeout(() => void refreshTranscript(), 0);
    }
  } catch (error) {
    if (requestGeneration === generation) {
      status.textContent = error.message;
    }
  } finally {
    transcriptRunning = false;
  }
}
fullTranscript.onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_TRANSCRIPT" });
  if (result?.error) {
    status.textContent = result.error;
  }
};
const transcriptTimer = setInterval(() => void refreshTranscript(), 2000);
window.addEventListener("pagehide", () => {
  visible = false;
  clearInterval(transcriptTimer);
});
void refreshTranscript();
