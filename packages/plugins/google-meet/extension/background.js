/* global chrome */

const chrome = globalThis.chrome;
const SESSION_KEY = "captureSession";

async function getSession() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || null;
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) {
    await chrome.action.setBadgeBackgroundColor({ color });
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      justification: "Capture Google Meet audio for live transcription",
      reasons: ["USER_MEDIA"],
      url: "offscreen.html",
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_FROM_NAKAMA") {
    start(message.captureUrl, message.meetingUrl)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === "START") {
    start(message.captureUrl)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === "STOP") {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
    sendResponse({ ok: true });
  }
  if (message.type === "STATE") {
    getSession().then((session) => sendResponse({ session }));
    return true;
  }
});

async function start(captureUrl, meetingUrl) {
  if (!(captureUrl && captureUrl.startsWith("ws"))) {
    throw new Error("Paste the capture URL from Nakama first");
  }
  const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
  const tab = meetingUrl
    ? tabs.find((candidate) => candidate.url === meetingUrl)
    : tabs.find((candidate) => candidate.active);
  if (!(tab?.id && tab.url?.startsWith("https://meet.google.com/"))) {
    throw new Error("Open a Google Meet tab first");
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });
  await ensureOffscreen();
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      captureUrl,
      startedAt: Date.now(),
      status: "starting",
      tabId: tab.id,
      tabUrl: tab.url,
    },
  });
  await setBadge("REC", "#dc2626");
  chrome.runtime.sendMessage({ streamId, type: "START_CAPTURE" });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CAPTURE_STARTED") {
    getSession().then(async (session) => {
      if (!session) {
        return;
      }
      await chrome.storage.session.set({
        [SESSION_KEY]: { ...session, status: "recording" },
      });
      await setBadge("REC", "#dc2626");
      void chrome.tabs.sendMessage(session.tabId, { type: "CAPTURE_STARTED" });
    });
  }
  if (message.type === "CAPTURE_STOPPED" || message.type === "CAPTURE_ERROR") {
    getSession().then(async (session) => {
      if (session) {
        await chrome.storage.session.set({
          [SESSION_KEY]: {
            ...session,
            error: message.error,
            status: message.type === "CAPTURE_ERROR" ? "error" : "stopped",
          },
        });
      }
      await setBadge(message.type === "CAPTURE_ERROR" ? "!" : "", "#dc2626");
    });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session?.tabId === tabId) {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  }
});
