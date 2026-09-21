/* global chrome */

const chrome = globalThis.chrome;
const isMeet = location.hostname === "meet.google.com";
const isNakamaMeetPage = () => location.pathname === "/plugins/google-meet";
const pending = new Map();
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
const badge = isMeet ? document.createElement("div") : undefined;
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
  }
  if (message.type === "CAPTURE_STOPPED" && badge) {
    badge.style.display = "none";
  }
});
