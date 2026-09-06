import { type FormEvent, useEffect, useState } from "react";

type Bootstrap = {
  actionBaseUrl: string;
  orgId: string;
  pluginId: string;
  pluginVersion: string;
  theme: "dark" | "light";
};

type Note = {
  body: string;
  createdAt: string;
  id: string;
  pinned?: number;
  title: string;
};

async function readBootstrap(): Promise<Bootstrap> {
  const theme = new URLSearchParams(window.location.search).get("theme") ?? "";
  const response = await fetch(
    `__nakama/bootstrap.json?theme=${encodeURIComponent(theme)}`
  );
  if (!response.ok) {
    throw new Error("bootstrap failed");
  }
  return (await response.json()) as Bootstrap;
}

async function callAction<T>(
  bootstrap: Bootstrap,
  key: string,
  input: Record<string, unknown>
): Promise<T> {
  const csrfToken = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("nakama_csrf="))
    ?.slice("nakama_csrf=".length);
  const response = await fetch(`${bootstrap.actionBaseUrl}/${key}`, {
    body: JSON.stringify({ input }),
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
      "X-Org-Id": bootstrap.orgId,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`${key} failed`);
  }
  const payload = (await response.json()) as { result?: T };
  return payload.result as T;
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    void (async () => {
      const next = await readBootstrap();
      const listed = await callAction<{ notes: Note[] }>(next, "list", {});
      setBootstrap(next);
      setNotes(listed.notes);
      parent.postMessage(
        { pluginId: "notes", type: "nakama-plugin-ready" },
        window.location.origin
      );
    })();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!bootstrap) {
      return;
    }
    await callAction(bootstrap, "create", { body, title });
    const listed = await callAction<{ notes: Note[] }>(bootstrap, "list", {});
    setNotes(listed.notes);
    setTitle("");
    setBody("");
  }

  return (
    <main data-theme={bootstrap?.theme ?? "light"}>
      <h1>Notes</h1>
      <form onSubmit={onSubmit}>
        <label>
          Title
          <input
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <label>
          Body
          <textarea
            onChange={(event) => setBody(event.target.value)}
            value={body}
          />
        </label>
        <button type="submit">Save</button>
      </form>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <strong>{note.title}</strong>
            {note.pinned ? " pinned" : ""}
            <p>{note.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
