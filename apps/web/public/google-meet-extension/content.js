/* global chrome */

const chrome = globalThis.chrome;

const isMeeting = /^\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(
  location.pathname
);

// The transcript lives in the side panel. This badge only tells people in
// the call that Nakama is recording.
const badge = isMeeting ? document.createElement("div") : undefined;

if (badge) {
  badge.textContent = "Nakama transcription active";
  badge.style.cssText =
    "display:none;position:fixed;z-index:2147483647;top:12px;right:12px;padding:6px 10px;border-radius:6px;background:#dc2626;color:white;font:12px system-ui";
  document.documentElement.append(badge);
  chrome.runtime
    .sendMessage({ type: "MEET_STATE" })
    .then((state) => {
      if (state?.status === "starting" || state?.status === "recording") {
        badge.style.display = "block";
      }
    })
    .catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || !badge) {
    return;
  }

  if (message.type === "CAPTURE_STARTED") {
    badge.style.display = "block";
  }

  if (message.type === "CAPTURE_STOPPED") {
    badge.style.display = "none";
  }
});
