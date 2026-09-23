/* global chrome */

const chrome = globalThis.chrome;
const isMeet = location.hostname === "meet.google.com";
const isMeeting =
  isMeet && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(location.pathname);
const isNakamaMeetPage = () => location.pathname === "/plugins/google-meet";
const pending = new Map();
let transcriptPanel;
let transcriptList;
let transcriptTimer;
let transcriptCursor = 0;
let transcriptMeeting;
let transcriptRunning = false;
const captionRows = new WeakMap();
let captionObserver;

function sendCaption(row, speakerName, text) {
  const state = captionRows.get(row) || {};
  if (state.sentText === text && state.sentSpeakerName === speakerName) {
    return;
  }
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.text === text && state.speakerName === speakerName) {
      state.sentText = text;
      state.sentSpeakerName = speakerName;
      void chrome.runtime.sendMessage({
        caption: {
          endMs: Date.now(),
          id: `${captionSequence++}`,
          speakerName,
          startMs: state.startedAt,
          text,
        },
        type: "MEET_CAPTION",
      });
    }
  }, 1200);
  if (state.text !== text || state.speakerName !== speakerName) {
    state.startedAt = Date.now();
  }
  state.speakerName = speakerName;
  state.text = text;
  state.startedAt ||= Date.now();
  captionRows.set(row, state);
}

let captionSequence = 0;
function captureMeetCaptions() {
  if (!isMeeting || captionObserver) {
    return;
  }
  const scan = () => {
    const region = document.querySelector(
      '[role="region"][aria-label*="caption" i]'
    );
    if (!region) {
      return;
    }
    for (const row of region.querySelectorAll(".nMcdL, [class*='nMcdL']")) {
      const speakerName = row.querySelector(".NWpY1d")?.textContent?.trim();
      const text = row.querySelector(".ygicle")?.textContent?.trim();
      if (speakerName && text) {
        sendCaption(row, speakerName, text);
      }
    }
  };
  captionObserver = new MutationObserver(scan);
  captionObserver.observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  setInterval(scan, 1000);
}

function createTranscriptPanel() {
  if (!isMeeting || transcriptPanel) {
    return;
  }
  transcriptPanel = document.createElement("aside");
  transcriptPanel.setAttribute("aria-label", "Nakama live transcript");
  const shadow = transcriptPanel.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      aside { position: fixed; z-index: 2147483646; top: 72px; right: 16px; width: 320px; max-height: min(70vh, 560px); display: grid; grid-template-rows: auto 1fr; overflow: hidden; color: #f8fafc; background: #18181b; border: 1px solid #3f3f46; border-radius: 12px; box-shadow: 0 12px 40px #0008; font: 14px/1.45 system-ui, sans-serif; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #3f3f46; }
      strong { font-size: 14px; }
      button { color: #a1a1aa; background: none; border: 0; font: inherit; font-size: 20px; line-height: 1; cursor: pointer; }
      button:hover { color: #fff; }
      #transcript { min-height: 100px; max-height: 500px; padding: 4px 14px 12px; overflow: auto; }
      p { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      span { display: block; margin-bottom: 2px; color: #fbbf24; font-size: 12px; font-weight: 600; }
      #empty { color: #a1a1aa; }
    </style>
    <aside>
      <header><strong>Live transcript</strong><button type="button" aria-label="Close transcript">×</button></header>
      <div id="transcript" role="log" aria-live="polite"><p id="empty">Waiting for the first transcript…</p></div>
    </aside>`;
  transcriptList = shadow.querySelector("#transcript");
  shadow.querySelector("button").addEventListener("click", hideTranscript);
  document.documentElement.append(transcriptPanel);
}

function hideTranscript() {
  transcriptPanel?.remove();
  transcriptPanel = undefined;
  transcriptList = undefined;
  clearInterval(transcriptTimer);
  transcriptTimer = undefined;
}

function showTranscript() {
  createTranscriptPanel();
  if (!transcriptPanel || transcriptTimer) {
    return;
  }
  transcriptCursor = 0;
  transcriptMeeting = undefined;
  transcriptRunning = false;
  transcriptTimer = setInterval(() => void refreshTranscript(), 2000);
  void refreshTranscript();
}

async function refreshTranscript() {
  if (!transcriptPanel || transcriptRunning) {
    return;
  }
  transcriptRunning = true;
  try {
    const result = await chrome.runtime.sendMessage({
      after: transcriptCursor,
      type: "MEET_TRANSCRIPT",
    });
    if (!(result && transcriptPanel)) {
      hideTranscript();
      return;
    }
    if (transcriptMeeting !== result.meeting.id) {
      transcriptMeeting = result.meeting.id;
      transcriptCursor = 0;
      transcriptList.replaceChildren();
    }
    const atBottom =
      transcriptList.scrollTop + transcriptList.clientHeight >=
      transcriptList.scrollHeight - 24;
    for (const segment of result.segments) {
      if (transcriptList.firstElementChild?.id === "empty") {
        transcriptList.firstElementChild.remove();
      }
      const turn = document.createElement("p");
      const speaker = document.createElement("span");
      speaker.textContent = segment.speakerName || "Unknown speaker";
      turn.append(speaker, document.createTextNode(segment.text));
      transcriptList.append(turn);
    }
    transcriptCursor = result.nextCursor;
    if (atBottom) {
      transcriptList.scrollTop = transcriptList.scrollHeight;
    }
  } catch {
    // The panel retries on the next poll; Meet navigation can invalidate the bridge.
  } finally {
    transcriptRunning = false;
  }
}

if (isMeeting) {
  captureMeetCaptions();
  chrome.runtime
    .sendMessage({ type: "MEET_STATE" })
    .then((state) => {
      if (state?.status === "starting" || state?.status === "recording") {
        showTranscript();
      }
    })
    .catch(() => undefined);
}
window.addEventListener("message", async (event) => {
  if (
    !isNakamaMeetPage() ||
    event.source !== window ||
    event.origin !== location.origin
  ) {
    return;
  }
  if (event.data?.type === "NAKAMA_MEET_PING") {
    let result = null;
    try {
      if (chrome.runtime?.id) {
        result = await chrome.runtime.sendMessage({ type: "BRIDGE_STATE" });
      }
    } catch {
      // Reloading the extension invalidates scripts in tabs until they refresh.
    }
    window.postMessage(
      {
        connected: result?.connected === true,
        type: "NAKAMA_MEET_EXTENSION",
      },
      location.origin
    );
  }
  if (event.data?.type === "NAKAMA_MEET_RESULT") {
    pending.get(event.data.id)?.(event.data);
  }
});
const badge = isMeeting ? document.createElement("div") : undefined;
if (badge) {
  badge.textContent = "Nakama transcription active";
  badge.style.cssText =
    "display:none;position:fixed;z-index:2147483647;top:12px;right:12px;padding:6px 10px;border-radius:6px;background:#dc2626;color:white;font:12px system-ui";
  document.documentElement.append(badge);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  if (message.type === "NAKAMA_MEET_ACTION" && isNakamaMeetPage()) {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      sendResponse({ error: "Open Google Meet in Nakama and try again." });
    }, 15_000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      pending.delete(id);
      sendResponse({ error: response.error, result: response.result });
    });
    window.postMessage({ ...message, id }, location.origin);
    return true;
  }
  if (message.type === "CAPTURE_STARTED" && badge) {
    badge.style.display = "block";
    showTranscript();
  }
  if (message.type === "CAPTURE_STOPPED" && badge) {
    badge.style.display = "none";
    hideTranscript();
  }
});
