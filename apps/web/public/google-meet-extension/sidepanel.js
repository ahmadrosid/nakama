/* global chrome */

const chrome = globalThis.chrome;

const status = document.querySelector("#status");

const connectForm = document.querySelector("#connect-form");

const origin = document.querySelector("#origin");

const connect = document.querySelector("#connect");

const pairCode = document.querySelector("#pair-code");

const disconnect = document.querySelector("#disconnect");

const start = document.querySelector("#start");

const stop = document.querySelector("#stop");

const settings = document.querySelector("#settings");

const settingsPanel = document.querySelector("#settings-panel");

const cancelPair = document.querySelector("#cancel-pair");

const timer = document.querySelector("#timer");

const live = document.querySelector("#live");

const MEET_CODE = /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/;

let busy = false;

let recordingNow = false;

let startedAt;

let transcriptMeeting;

let meetingState;

let onMeetNow = false;

let sessionNow;

let meetingHeading = "";

let lineCount = 0;

// Copy text keeps the newest lines only, so a long call cannot grow it forever.
const COPY_LIMIT = 10_000;

const copyLines = [];

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);

  const clock = [Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return hours ? `${hours}:${clock}` : clock;
}

function tickTimer() {
  if (recordingNow && startedAt) {
    timer.textContent = formatElapsed(Date.now() - startedAt);
  }
}

async function refresh() {
  const [state, tabs] = await Promise.all([
    chrome.runtime.sendMessage({ type: "STATE" }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);

  const url = new URL(tabs[0]?.url || "about:blank");

  const recording = ["starting", "recording"].includes(
    state?.captureSession?.status
  );

  const connected = state?.connected === true;

  const pairing = state?.pairing?.code;

  const session = state?.captureSession;

  recordingNow = recording;
  sessionNow = session;
  startedAt = session?.startedAt;

  const onMeet =
    url.origin === "https://meet.google.com" &&
    /^\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname);

  onMeetNow = onMeet;

  const badge = document.querySelector("#connection");
  badge.textContent = connected ? "Connected" : "Not connected";
  badge.dataset.connected = String(connected);
  meetingHeading = recording
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

  if (!origin.value && state?.origin) {
    origin.value = state.origin;
  }

  tickTimer();

  const meetingPath = new URL(session?.tabUrl || "about:blank").pathname;
  document.querySelector("#meeting-info").textContent =
    `${MEET_CODE.exec(meetingPath)?.[1] ?? "Google Meet"} · tab and microphone`;

  settings.hidden = !connected;
  document.querySelector("#settings-origin").textContent = state?.origin
    ? `Connected to ${state.origin}`
    : "";

  if (!connected) {
    settingsPanel.hidden = true;
  }

  connectForm.hidden = connected || Boolean(pairing) || recording;
  connect.disabled = busy || recording;
  pairCode.hidden = !pairing || connected;
  pairCode.textContent = pairing || "";
  cancelPair.hidden = !pairing || connected;
  disconnect.hidden = !(connected || pairing) || recording;
  disconnect.disabled = busy || recording;
  start.hidden = !connected || recording;
  start.disabled = busy || recording || !connected;
  stop.hidden = !recording;
  stop.disabled = busy || !recording;
  status.textContent =
    state?.captureSession?.error ||
    state?.pairError ||
    (recording
      ? "Transcribing."
      : connected
        ? onMeet
          ? "Ready."
          : "Open the extension in your Meet tab."
        : pairing
          ? "Approve this code in the Nakama tab."
          : "Enter your Nakama address, then connect.");
  renderResult();
}

// After Stop the panel shows the meeting's result: finishing, then saved.
function renderResult() {
  const done =
    Boolean(transcriptMeeting) &&
    meetingState !== "failed" &&
    (["transcribing", "finished"].includes(meetingState) || !recordingNow);

  const saved = done && meetingState === "finished";

  const doneCard = document.querySelector("#done-card");
  doneCard.hidden = !done;
  doneCard.dataset.state = saved ? "saved" : "finishing";
  document.querySelector("#recording-card").hidden = !recordingNow || done;
  document.querySelector("#setup").hidden = recordingNow || (done && onMeetNow);
  document.querySelector("#meeting").textContent =
    done && !onMeetNow ? "Next meeting" : meetingHeading;

  const code =
    MEET_CODE.exec(
      new URL(sessionNow?.tabUrl || "about:blank").pathname
    )?.[1] ?? "Google Meet";

  const length = startedAt
    ? formatElapsed((sessionNow?.stoppedAt ?? Date.now()) - startedAt)
    : "";

  document.querySelector("#done-title").textContent = saved
    ? onMeetNow
      ? "Transcript saved"
      : "Transcript saved in Nakama"
    : "Finishing transcript";
  document.querySelector("#done-meta").textContent = [
    code,
    length,
    saved
      ? `${lineCount} ${lineCount === 1 ? "line" : "lines"}`
      : "writing the last lines",
  ]
    .filter(Boolean)
    .join(" · ");
  document.querySelector("#done-actions").hidden = !saved;
  recordAgain.hidden = !onMeetNow;
  live.hidden = !(recordingNow || transcriptMeeting);
  document.querySelector("#live-title").textContent = done
    ? "Transcript"
    : "Live transcript";
  fullTranscript.hidden = !transcriptMeeting || done;
}

async function run(type, input = {}) {
  busy = true;
  connect.disabled =
    disconnect.disabled =
    start.disabled =
    recordAgain.disabled =
    stop.disabled =
      true;
  status.textContent =
    type === "START"
      ? "Starting transcription…"
      : type === "STOP"
        ? "Stopping transcription…"
        : type === "DISCONNECT"
          ? "Disconnecting…"
          : "Connecting…";

  try {
    const result = await chrome.runtime.sendMessage({ ...input, type });

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

connectForm.onsubmit = async (event) => {
  event.preventDefault();
  const value = origin.value.trim();
  let url;

  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    status.textContent = "Enter your Nakama address.";

    return;
  }

  // Chrome asks for site access only during the click, so this comes first.
  const granted = await chrome.permissions.request({
    origins: [`${url.protocol}//${url.hostname}/*`],
  });

  if (!granted) {
    status.textContent = "Allow access to your Nakama address to connect.";

    return;
  }

  await run("CONNECT", { origin: url.origin });
};

disconnect.onclick = () => run("DISCONNECT");

cancelPair.onclick = () => run("DISCONNECT");

settings.onclick = () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settings.setAttribute("aria-expanded", String(!settingsPanel.hidden));
};

start.onclick = () => run("START");

const recordAgain = document.querySelector("#record-again");

recordAgain.onclick = () => run("START");

document.querySelector("#copy-text").onclick = () => {
  navigator.clipboard
    .writeText(copyLines.join("\n"))
    .then(() => {
      status.textContent = "Transcript copied.";
    })
    .catch((error) => {
      console.warn("[Nakama Meet] copy failed", error.message);
      status.textContent = "Could not copy. Open the transcript in Nakama.";
    });
};

stop.onclick = () => run("STOP");

// The side panel stays open across tabs, so follow the tab the user is on.
function refreshForTab() {
  if (!busy) {
    refresh().catch((error) => {
      status.textContent = error.message;
    });
  }
}

chrome.tabs.onActivated.addListener(refreshForTab);

chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url || change.status === "complete") {
    refreshForTab();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    !busy &&
    ((area === "session" &&
      (changes.captureSession || changes.pairing || changes.pairError)) ||
      (area === "local" && (changes.meetKey || changes.nakamaOrigin)))
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

let cursor = 0;

let transcriptRunning = false;

let visible = true;

let generation = 0;

let terminal = false;

const turnIds = new Set();

// Two colors, alternating by speaker in the order they first speak.
const speakerTones = new Map();

function resetTranscript() {
  generation++;
  transcriptMeeting = undefined;
  cursor = 0;
  terminal = false;
  turnIds.clear();
  speakerTones.clear();
  meetingState = undefined;
  lineCount = 0;
  copyLines.length = 0;
  transcript.replaceChildren();
  fullTranscript.hidden = true;
  live.hidden = !recordingNow;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === "local" && (changes.meetKey || changes.nakamaOrigin)) ||
    (area === "session" &&
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
    live.hidden = false;

    const atBottom =
      transcript.scrollTop + transcript.clientHeight >=
      transcript.scrollHeight - 24;

    for (const segment of result.segments) {
      if (turnIds.has(segment.id)) {
        continue;
      }

      turnIds.add(segment.id);
      const speaker = segment.speakerName || "Unknown speaker";

      if (!speakerTones.has(speaker)) {
        speakerTones.set(speaker, speakerTones.size % 2 ? "b" : "a");
      }

      const turn = document.createElement("li");
      turn.dataset.id = segment.id;
      const time = document.createElement("time");
      time.textContent = startedAt
        ? formatElapsed(segment.receivedAt - startedAt)
        : "";
      const body = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = speaker;
      label.dataset.tone = speakerTones.get(speaker);
      lineCount++;
      copyLines.push(`${speaker}: ${segment.text}`);

      if (copyLines.length > COPY_LIMIT) {
        copyLines.shift();
      }

      body.append(label, document.createTextNode(segment.text));
      turn.append(time, body);
      transcript.append(turn);
    }

    while (transcript.children.length > 200) {
      turnIds.delete(transcript.firstElementChild.dataset.id);
      transcript.firstElementChild.remove();
    }

    cursor = result.nextCursor;
    meetingState = result.meeting.state;
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
      status.textContent =
        "You can close this panel. The transcript stays in Nakama.";
    } else if (turnIds.size === 0) {
      status.textContent = "Waiting for the first transcript…";
    } else if (result.meeting.state === "recording") {
      status.textContent = "Transcribing.";
    }

    renderResult();

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

async function openTranscript() {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_TRANSCRIPT" });

  if (result?.error) {
    status.textContent = result.error;
  }
}

fullTranscript.onclick = openTranscript;

document.querySelector("#open-saved").onclick = openTranscript;

const clockTimer = setInterval(tickTimer, 1000);

const transcriptTimer = setInterval(() => void refreshTranscript(), 2000);

window.addEventListener("pagehide", () => {
  visible = false;
  clearInterval(transcriptTimer);
  clearInterval(clockTimer);
});

void refreshTranscript();
