/* global chrome */

const chrome = globalThis.chrome;

const SESSION_KEY = "captureSession";

const PAIR_POLL_MS = 2000;

const PAIR_MAX_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

// Meet serves calls at /<code> and at /meet/<code>; Nakama stores /<code>.
const MEET_PATH = /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/;

let starting = false;

let pairTimer;

async function getSession() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || null;
}

async function recording() {
  return (
    starting || ["starting", "recording"].includes((await getSession())?.status)
  );
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

/** The origin of a Nakama address the user typed, or an error. */
function nakamaOrigin(value) {
  const text = String(value ?? "").trim();
  let url;

  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error("Enter your Nakama address.");
  }

  if (!(["http:", "https:"].includes(url.protocol) && url.hostname)) {
    throw new Error("Enter your Nakama address.");
  }

  return url.origin;
}

function originPattern(origin) {
  const url = new URL(origin);

  return `${url.protocol}//${url.hostname}/*`;
}

/** A string field of a JSON reply, or "" when it is missing or not text. */
function text(value) {
  return Object(value) instanceof String ? value : "";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Calls a key-only Meet route. A 401 means the key is dead, so drop it. */
async function api(path, init = {}) {
  const { meetKey, nakamaOrigin: origin } = await chrome.storage.local.get([
    "meetKey",
    "nakamaOrigin",
  ]);

  if (!(meetKey && origin)) {
    throw new Error("Connect Nakama first.");
  }

  const response = await fetch(new URL(path, origin).href, {
    ...init,
    credentials: "omit",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${meetKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401) {
    const current = await chrome.storage.local.get("meetKey");

    if (current.meetKey === meetKey) {
      await chrome.storage.local.remove("meetKey");
    }

    throw new Error("Nakama disconnected this browser. Connect again.");
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(
      text(body?.error) || `Nakama returned an error (${response.status}).`
    );
  }

  return body;
}

function post(path, body) {
  return api(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function leave(meetingId) {
  return post("/v1/meet/extension/leave", { meetingId }).catch((error) =>
    console.warn("[Nakama Meet] leave failed", error.message)
  );
}

function schedulePairingPoll() {
  clearTimeout(pairTimer);
  pairTimer = setTimeout(() => void pollPairing(), PAIR_POLL_MS);
}

async function pollPairing() {
  pairTimer = undefined;
  const { pairing } = await chrome.storage.session.get("pairing");

  if (!pairing) {
    return;
  }

  if (Date.now() >= pairing.expiresAt) {
    await chrome.storage.session.remove("pairing");
    await chrome.storage.session.set({
      pairError: "The code expired. Connect again.",
    });

    return;
  }

  let response;

  try {
    response = await fetch(
      `${pairing.origin}/v1/meet/extension/pair/${encodeURIComponent(pairing.pairId)}`,
      { credentials: "omit", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
  } catch (error) {
    console.warn("[Nakama Meet] pairing check failed", error.message);
  }

  const body = response?.ok ? await readJson(response) : null;
  const latest = (await chrome.storage.session.get("pairing")).pairing;

  // Disconnect or a new Connect replaced this pairing while it was in flight.
  if (latest?.pairId !== pairing.pairId) {
    return;
  }

  if (response?.status === 404) {
    await chrome.storage.session.remove("pairing");
    await chrome.storage.session.set({
      pairError: "The code expired. Connect again.",
    });

    return;
  }

  if (body?.status === "approved" && text(body.key)) {
    await chrome.storage.local.set({
      meetKey: body.key,
      nakamaOrigin: pairing.origin,
    });
    await chrome.storage.session.remove("pairing");

    return;
  }

  schedulePairingPoll();
}

async function connect(address) {
  if (await recording()) {
    throw new Error("Stop the current transcription first.");
  }

  const origin = nakamaOrigin(address);

  if (
    !(await chrome.permissions.contains({ origins: [originPattern(origin)] }))
  ) {
    throw new Error("Allow access to your Nakama address to connect.");
  }

  const response = await fetch(`${origin}/v1/meet/extension/pair`, {
    credentials: "omit",
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await readJson(response);

  if (!(response.ok && text(body?.pairId) && text(body.code))) {
    throw new Error(
      text(body?.error) || "Nakama did not start pairing. Check the address."
    );
  }

  const expiresIn = Number.isFinite(body.expiresIn)
    ? Math.min(body.expiresIn * 1000, PAIR_MAX_MS)
    : PAIR_MAX_MS;

  await chrome.storage.local.remove("meetKey");
  await chrome.storage.local.set({ nakamaOrigin: origin });
  await chrome.storage.session.remove(["pairError", SESSION_KEY]);
  await chrome.storage.session.set({
    pairing: {
      code: body.code,
      expiresAt: Date.now() + expiresIn,
      origin,
      pairId: body.pairId,
    },
  });
  await chrome.tabs.create({
    url: `${origin}/google-meet?pair=${encodeURIComponent(body.code)}`,
  });
  schedulePairingPoll();

  return { code: body.code };
}

async function disconnect() {
  if (await recording()) {
    throw new Error("Stop the current transcription first.");
  }

  clearTimeout(pairTimer);
  pairTimer = undefined;
  await chrome.storage.local.remove("meetKey");
  await chrome.storage.session.remove(["pairError", "pairing", SESSION_KEY]);

  return { ok: true };
}

async function meetingSessionForTab(tabId) {
  const session = await getSession();

  if (
    !(session && ["starting", "recording"].includes(session.status)) ||
    session.tabId !== tabId
  ) {
    return null;
  }

  return session;
}

async function transcript(session, after) {
  if (!Number.isSafeInteger(after) || after < 0) {
    throw new Error("Invalid transcript cursor");
  }

  const { nakamaOrigin: origin } =
    await chrome.storage.local.get("nakamaOrigin");

  if (session.origin !== origin) {
    return null;
  }

  return api(
    `/v1/meet/extension/transcript?${new URLSearchParams({
      after: String(after),
      meetingId: session.meetingId,
    })}`
  );
}

async function start() {
  if (starting) {
    throw new Error("Transcription is already starting.");
  }

  starting = true;
  let meeting;

  try {
    const session = await getSession();

    if (["starting", "recording"].includes(session?.status)) {
      throw new Error("Stop the current transcription first.");
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    const url = new URL(tab?.url || "about:blank");

    if (
      !tab?.id ||
      url.origin !== "https://meet.google.com" ||
      !MEET_PATH.test(url.pathname)
    ) {
      throw new Error("Join a Google Meet meeting in this tab first.");
    }

    const { meetKey, nakamaOrigin: origin } = await chrome.storage.local.get([
      "meetKey",
      "nakamaOrigin",
    ]);

    if (!(meetKey && origin)) {
      throw new Error("Connect Nakama first.");
    }

    // Chrome allows tab capture only after the toolbar button was clicked on
    // this tab (activeTab). The open side panel alone does not count.
    let streamId;

    try {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id,
      });
    } catch (error) {
      console.warn("[Nakama Meet] tab capture refused", error.message);
      throw new Error(
        "Click the Nakama icon in the toolbar on this Meet tab, then start again."
      );
    }

    const status = await api("/v1/meet/extension/status");

    if (status?.captureProtocol !== 3) {
      throw new Error("Update Nakama first.");
    }

    await ensureOffscreen();
    meeting = await post("/v1/meet/extension/start", {
      url: `https://meet.google.com/${MEET_PATH.exec(url.pathname)[1]}`,
    });

    if (
      !(
        text(meeting?.meetingId) &&
        text(meeting.ticket) &&
        text(meeting.captureUrl)
      )
    ) {
      throw new Error("The transcription service is not ready.");
    }

    const captureUrl = new URL(meeting.captureUrl);

    if (!["ws:", "wss:"].includes(captureUrl.protocol)) {
      throw new Error("Invalid capture connection.");
    }

    await chrome.storage.session.set({
      [SESSION_KEY]: {
        captureUrl: captureUrl.href,
        meetingId: meeting.meetingId,
        origin,
        startedAt: Date.now(),
        status: "starting",
        tabId: tab.id,
        tabUrl: tab.url,
      },
    });

    const result = await chrome.runtime.sendMessage({
      captureUrl: captureUrl.href,
      meetingId: meeting.meetingId,
      streamId,
      ticket: meeting.ticket,
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
    if (meeting?.meetingId) {
      await leave(meeting.meetingId);
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

async function state() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(["meetKey", "nakamaOrigin"]),
    chrome.storage.session.get(["pairError", "pairing", SESSION_KEY]),
  ]);

  const capture = session[SESSION_KEY];
  await setBadge(
    capture?.error ? "!" : capture?.status === "recording" ? "REC" : "",
    "#dc2626"
  );

  return {
    captureSession: capture,
    connected: Boolean(local.meetKey),
    origin: local.nakamaOrigin,
    pairError: session.pairError,
    pairing: session.pairing ? { code: session.pairing.code } : undefined,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }

  const fromExtensionPage =
    !sender.tab &&
    sender.url?.startsWith(chrome.runtime.getURL("sidepanel.html"));

  const fromMeetTab = Boolean(sender.tab?.id) && message.type === "MEET_STATE";

  if (!(fromExtensionPage || fromMeetTab)) {
    return;
  }

  let work;

  if (message.type === "CONNECT" && fromExtensionPage) {
    work = connect(message.origin);
  } else if (message.type === "DISCONNECT" && fromExtensionPage) {
    work = disconnect();
  } else if (message.type === "START" && fromExtensionPage) {
    work = start();
  } else if (message.type === "STOP" && fromExtensionPage) {
    work = chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  } else if (message.type === "MEET_STATE" && fromMeetTab) {
    work = meetingSessionForTab(sender.tab.id).then((session) =>
      session ? { meetingId: session.meetingId, status: session.status } : null
    );
  } else if (message.type === "TRANSCRIPT" && fromExtensionPage) {
    work = getSession().then(async (session) => {
      if (!session) {
        return null;
      }

      const result = await transcript(session, message.after ?? 0);

      // Drop a reply for a meeting that was replaced while it was in flight.
      return (await getSession())?.meetingId === session.meetingId
        ? result
        : null;
    });
  } else if (message.type === "OPEN_TRANSCRIPT" && fromExtensionPage) {
    work = chrome.storage.local
      .get("nakamaOrigin")
      .then(async ({ nakamaOrigin: origin }) => {
        if (!origin) {
          throw new Error("Connect Nakama first.");
        }

        await chrome.tabs.create({ url: `${origin}/google-meet` });

        return { ok: true };
      });
  } else if (message.type === "STATE" && fromExtensionPage) {
    work = state();
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

  const isRecording = message.type === "CAPTURE_STARTED";
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      ...session,
      error: message.error,
      status: isRecording
        ? "recording"
        : message.type === "CAPTURE_ERROR"
          ? "error"
          : "stopped",
    },
  });
  await setBadge(
    isRecording ? "REC" : message.type === "CAPTURE_ERROR" ? "!" : "",
    "#dc2626"
  );
  await chrome.tabs
    .sendMessage(session.tabId, {
      type: isRecording ? "CAPTURE_STARTED" : "CAPTURE_STOPPED",
    })
    .catch(() => undefined);

  if (!isRecording) {
    await leave(session.meetingId);
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

// The toolbar button opens the side panel; there is no popup.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) =>
    console.warn("[Nakama Meet] side panel behavior failed", error.message)
  );

// A service worker restart drops timers; resume a pairing that is still open.
chrome.storage.session.get("pairing").then(({ pairing }) => {
  if (pairing) {
    schedulePairingPoll();
  }
});
