import { createElement, StrictMode, useEffect, useState } from "./react.js";
import { createRoot } from "./react-dom.js";

async function readBootstrap() {
  const theme = new URLSearchParams(window.location.search).get("theme") ?? "";
  const response = await fetch(
    `__nakama/bootstrap.json?theme=${encodeURIComponent(theme)}`
  );
  if (!response.ok) {
    throw new Error("bootstrap failed");
  }
  return response.json();
}

async function callAction(bootstrap, key, input) {
  const response = await fetch(`${bootstrap.actionBaseUrl}/${key}`, {
    body: JSON.stringify({ input }),
    headers: {
      "Content-Type": "application/json",
      "X-Org-Id": bootstrap.orgId,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`${key} failed`);
  }
  const payload = await response.json();
  return payload.result;
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    void (async () => {
      const next = await readBootstrap();
      const listed = await callAction(next, "list", {});
      setBootstrap(next);
      setNotes(listed.notes);
      parent.postMessage(
        { pluginId: "notes", type: "nakama-plugin-ready" },
        window.location.origin
      );
    })();
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    if (!bootstrap) {
      return;
    }
    await callAction(bootstrap, "create", { body, title });
    const listed = await callAction(bootstrap, "list", {});
    setNotes(listed.notes);
    setTitle("");
    setBody("");
  }

  return createElement(
    "main",
    { "data-theme": bootstrap?.theme ?? "light" },
    createElement("h1", null, "Notes"),
    createElement(
      "form",
      { onSubmit },
      createElement(
        "label",
        null,
        "Title",
        createElement("input", {
          onChange: (event) => setTitle(event.target.value),
          required: true,
          value: title,
        })
      ),
      createElement(
        "label",
        null,
        "Body",
        createElement("textarea", {
          onChange: (event) => setBody(event.target.value),
          value: body,
        })
      ),
      createElement("button", { type: "submit" }, "Save")
    ),
    createElement(
      "ul",
      null,
      notes.map((note) =>
        createElement(
          "li",
          { key: note.id },
          createElement("strong", null, note.title),
          note.pinned ? " pinned" : "",
          createElement("p", null, note.body)
        )
      )
    )
  );
}

const root = document.getElementById("root");
createRoot(root).render(createElement(StrictMode, null, createElement(App)));
