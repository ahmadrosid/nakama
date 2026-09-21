"use strict";
const { ipcRenderer } = require("electron");

// Observe the existing web preference without exposing native APIs to the page.
window.addEventListener("DOMContentLoaded", () => {
  const syncTheme = () => {
    let theme = document.documentElement.dataset.theme;
    if (!theme) {
      try {
        theme = localStorage.getItem("nakama-theme");
      } catch {
        // Storage can be unavailable on error pages.
      }
    }
    ipcRenderer.send(
      "nakama:theme",
      ["light", "dark", "system"].includes(theme) ? theme : "system"
    );
  };
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });
  syncTheme();
});
