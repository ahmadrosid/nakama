/* global chrome */

const chrome = globalThis.chrome;
const SESSION_KEY = "captureSession";
let starting = false;

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

async function callNakama(connection, action, input = {}) {
  if (!connection) {
    throw new Error(
      "Open Google Meet in Nakama and connect this extension first."
    );
  }
  const tab = await chrome.tabs.get(connection.tabId).catch(() => null);
  if (tab?.url !== connection.url) {
    throw new Error("Keep the connected Nakama Google Meet tab open.");
  }
  const response = await chrome.tabs.sendMessage(connection.tabId, {
    action,
    input,
    type: "NAKAMA_MEET_ACTION",
  });
  if (!response || response.error) {
    throw new Error(
      response?.error || "Nakama did not respond. Refresh its Google Meet page."
    );
  }
  return response.result;
}

async function connect() {
  const session = await getSession();
  if (starting || ["starting", "recording"].includes(session?.status)) {
    throw new Error("Stop the current recording before reconnecting.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url || "about:blank");
  if (
    !(tab?.id && ["http:", "https:"].includes(url.protocol)) ||
    url.pathname !== "/plugins/google-meet"
  ) {
    throw new Error("Open the Google Meet page in Nakama, then click Connect.");
  }
  const connection = { tabId: tab.id, url: tab.url };
  const setup = await callNakama(connection, "meetings");
  if (setup.captureProtocol !== 2) {
    throw new Error("Update the Nakama Google Meet plugin first.");
  }
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.storage.session.set({ connection });
  return { ok: true };
}

async function start() {
  if (starting) {
    throw new Error("Transcription is already starting.");
  }
  starting = true;
  let meeting;
  let connection;
  try {
    const session = await getSession();
    if (["starting", "recording"].includes(session?.status)) {
      throw new Error("Stop the current transcription first.");
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = new URL(tab?.url || "about:blank");
    if (
      !tab?.id ||
      url.origin !== "https://meet.google.com" ||
      !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
    ) {
      throw new Error("Join a Google Meet meeting in this tab first.");
    }
    ({ connection } = await chrome.storage.session.get("connection"));
    // Obtain tab access while handling the user's extension click.
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });
    const setup = await callNakama(connection, "meetings");
    if (setup.captureProtocol !== 2) {
      throw new Error("Update the Nakama Google Meet plugin first.");
    }
    await ensureOffscreen();
    meeting = await callNakama(connection, "start-capture", {
      url: url.origin + url.pathname,
    });
    if (!meeting?.capture?.url) {
      throw new Error("The transcription service is not ready.");
    }
    const captureUrl = new URL(meeting.capture.url);
    if (!["ws:", "wss:"].includes(captureUrl.protocol)) {
      throw new Error("Invalid capture connection.");
    }
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        captureUrl: captureUrl.href,
        connection,
        meetingId: meeting.id,
        startedAt: Date.now(),
        status: "starting",
        tabId: tab.id,
        tabUrl: tab.url,
      },
    });
    const result = await chrome.runtime.sendMessage({
      captureUrl: captureUrl.href,
      streamId,
      type: "START_CAPTURE",
    });
    if (!result?.ok) {
      if (result?.needsMicrophone) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("microphone.html"),
        });
      }
      throw new Error(result?.error || "Could not capture meeting audio.");
    }
    return { ok: true };
  } catch (error) {
    if (meeting?.id) {
      await callNakama(connection, "leave", { meetingId: meeting.id }).catch(
        () => undefined
      );
      await chrome.storage.session.set({
        [SESSION_KEY]: {
          ...(await getSession()),
          error: error.message,
          status: "error",
        },
      });
      await setBadge("!", "#dc2626");
    }
    throw error;
  } finally {
    starting = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  if (message.type === "BRIDGE_STATE" && sender.tab) {
    chrome.storage.session.get("connection").then(({ connection }) => {
      sendResponse({
        connected:
          connection?.tabId === sender.tab.id && connection?.url === sender.url,
      });
    });
    return true;
  }
  if (sender.url !== chrome.runtime.getURL("popup.html") || sender.tab) {
    return;
  }
  let work;
  if (message.type === "CONNECT") {
    work = connect();
  } else if (message.type === "START") {
    work = start();
  } else if (message.type === "STOP") {
    work = chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  } else if (["TRANSCRIPT", "OPEN_TRANSCRIPT"].includes(message.type)) {
    work = (async () => {
      const session = await getSession();
      const { connection } = await chrome.storage.session.get("connection");
      if (
        !session ||
        connection?.tabId !== session.connection?.tabId ||
        connection?.url !== session.connection?.url
      ) {
        return null;
      }
      const after = message.after ?? 0;
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error("Invalid transcript cursor");
      }
      const result = await callNakama(
        connection,
        message.type === "OPEN_TRANSCRIPT" ? "show-transcript" : "transcript",
        { after, meetingId: session.meetingId }
      );
      if (message.type === "OPEN_TRANSCRIPT") {
        await chrome.tabs.update(connection.tabId, { active: true });
      }
      const current = await getSession();
      const latest = (await chrome.storage.session.get("connection"))
        .connection;
      if (
        current?.meetingId !== session.meetingId ||
        latest?.tabId !== connection.tabId ||
        latest?.url !== connection.url
      ) {
        return null;
      }
      return result;
    })();
  } else if (message.type === "STATE") {
    work = chrome.storage.session
      .get(["connection", SESSION_KEY])
      .then(async (state) => {
        if (state.connection) {
          let tab;
          try {
            tab = await chrome.tabs.get(state.connection.tabId);
          } catch {
            // Chrome rejects get() when the connected tab has been closed.
          }
          if (tab?.url !== state.connection.url) {
            await chrome.storage.session.remove("connection");
            delete state.connection;
          }
        }
        const session = state[SESSION_KEY];
        await setBadge(
          session?.error ? "!" : session?.status === "recording" ? "REC" : "",
          "#dc2626"
        );
        return state;
      });
  } else {
    return;
  }
  work
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("offscreen.html")
  ) {
    return;
  }
  if (
    !["CAPTURE_STARTED", "CAPTURE_STOPPED", "CAPTURE_ERROR"].includes(
      message.type
    )
  ) {
    return;
  }
  void updateCaptureState(message);
});

async function updateCaptureState(message) {
  const session = await getSession();
  if (!session) {
    return;
  }
  const recording = message.type === "CAPTURE_STARTED";
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      ...session,
      error: message.error,
      status: recording
        ? "recording"
        : message.type === "CAPTURE_ERROR"
          ? "error"
          : "stopped",
    },
  });
  await setBadge(
    recording ? "REC" : message.type === "CAPTURE_ERROR" ? "!" : "",
    "#dc2626"
  );
  await chrome.tabs
    .sendMessage(session.tabId, {
      type: recording ? "CAPTURE_STARTED" : "CAPTURE_STOPPED",
    })
    .catch(() => undefined);
  if (!recording) {
    await callNakama(session.connection, "leave", {
      meetingId: session.meetingId,
    }).catch(() => undefined);
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (
    session?.tabId === tabId &&
    ["starting", "recording"].includes(session.status)
  ) {
    await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  }
});
