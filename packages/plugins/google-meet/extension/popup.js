/* global chrome */

const chrome = globalThis.chrome;
const url = document.querySelector("#url");
const status = document.querySelector("#status");
chrome.storage.local.get("captureUrl").then(({ captureUrl }) => {
  url.value = captureUrl || "";
});
document.querySelector("#start").onclick = async () => {
  await chrome.storage.local.set({ captureUrl: url.value.trim() });
  const result = await chrome.runtime.sendMessage({
    captureUrl: url.value.trim(),
    type: "START",
  });
  status.textContent =
    result?.error || (result?.ok ? "Capturing" : "Could not start");
};
document.querySelector("#stop").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "STOP" });
  status.textContent = "Stopped";
};
