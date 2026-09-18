/* global chrome */

const chrome = globalThis.chrome;
const isMeet = location.hostname === "meet.google.com";
const isNakamaMeetPage = location.pathname.includes("/plugins/google-meet");
if (isNakamaMeetPage) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== "START_CAPTURE") {
      return;
    }
    chrome.runtime.sendMessage({
      ...event.data,
      type: "START_FROM_NAKAMA",
    });
  });
}
const badge = isMeet ? document.createElement("div") : undefined;
if (badge) {
  badge.textContent = "Nakama capture active";
  badge.style.cssText =
    "display:none;position:fixed;z-index:2147483647;top:12px;right:12px;padding:6px 10px;border-radius:6px;background:#dc2626;color:white;font:12px system-ui";
  document.documentElement.append(badge);
}
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CAPTURE_STARTED" && badge) {
    badge.style.display = "block";
  }
  if (message.type === "CAPTURE_STOPPED" && badge) {
    badge.style.display = "none";
  }
});
