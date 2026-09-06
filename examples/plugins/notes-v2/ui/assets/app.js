parent.postMessage(
  { pluginId: "notes", type: "nakama-plugin-ready" },
  window.location.origin
);
