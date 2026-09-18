// src/ui.tsx
var message = (error) => error instanceof Error ? error.message : "Request failed";
var inject = ["slots", "host", "styles", "ui"];
function meetingGroups(meetings, now = new Date) {
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map([["In progress", []]]);
  for (const meeting of meetings) {
    const date = new Date(meeting.createdAt);
    const title = ["queued", "joining", "transcribing"].includes(meeting.state) ? "In progress" : date.toDateString() === today ? "Today" : date.toDateString() === yesterday.toDateString() ? "Yesterday" : date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
    const group = groups.get(title) ?? [];
    group.push(meeting);
    groups.set(title, group);
  }
  return [...groups].filter(([, items]) => items.length).map(([title, items]) => ({ meetings: items, title }));
}
function apply(ctx) {
  const React = ctx.React;
  const { Button, Card, CodeBlock, ConfirmDialog, Delete02Icon } = ctx.ui;
  ctx.styles(`
    .meet-page{display:grid;gap:32px;max-width:768px;width:100%;min-width:0;margin:0 auto;font-size:14px}
    .meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .meet-card{box-shadow:none;overflow:hidden}
    .meet-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .meet-page h2,.meet-page h3{font-size:14px;font-weight:500;margin:0}
    .meet-list{list-style:none;padding:0;margin:0}
    .meet-list li{padding:16px;display:grid;gap:10px}
    .meet-list li+li{border-top:1px solid var(--border)}
    .meet-meeting{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .meet-meta{display:grid;gap:4px;min-width:0;flex:1 1 220px}
    .meet-link{font-weight:500;overflow-wrap:anywhere}
    .meet-link:hover{text-decoration:underline}
    .meet-status{font-size:12px;color:var(--muted-foreground);overflow-wrap:anywhere}
    .meet-badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--muted-foreground)}
    .meet-empty{padding:32px 16px;text-align:center;color:var(--muted-foreground);font-size:14px}
    .meet-page [role=alert]{font-size:14px;color:var(--destructive);overflow-wrap:anywhere}
    .meet-detail{display:grid;gap:16px;min-width:0}
    .meet-detail-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .meet-code{border:1px solid var(--border);border-radius:8px;min-width:0}
    `);
  function Transcript({ meeting, close }) {
    const [text, setText] = React.useState("");
    const [error, setError] = React.useState("");
    const [loaded, setLoaded] = React.useState(false);
    const heading = React.useRef(null);
    React.useEffect(() => heading.current?.focus(), []);
    React.useEffect(() => {
      let alive = true;
      let cursor = 0;
      let running = false;
      async function refresh() {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const value = await ctx.host.call("transcript", {
            after: cursor,
            meetingId: meeting.id
          });
          if (alive && !ctx.signal.aborted) {
            cursor = value.nextCursor;
            setText((previous) => previous + value.segments.map((segment) => segment.text + `
`).join(""));
            setError("");
            setLoaded(true);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      }
      refresh();
      const timer = setInterval(() => void refresh(), 2000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [meeting.id]);
    function download() {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `meeting-${meeting.id}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return /* @__PURE__ */ React.createElement("section", {
      className: "meet-detail"
    }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Button, {
      onClick: close,
      size: "sm",
      variant: "ghost"
    }, "← Back to meetings")), /* @__PURE__ */ React.createElement("div", {
      className: "meet-detail-heading"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-meta"
    }, /* @__PURE__ */ React.createElement("h2", {
      ref: heading,
      tabIndex: -1
    }, "Meeting transcript"), /* @__PURE__ */ React.createElement("a", {
      className: "meet-link",
      href: meeting.url,
      rel: "noreferrer",
      target: "_blank"
    }, meeting.url.replace("https://", "")), /* @__PURE__ */ React.createElement("span", {
      className: "meet-status"
    }, new Date(meeting.createdAt).toLocaleString(), " · ", meeting.state)), /* @__PURE__ */ React.createElement(Button, {
      disabled: !text,
      onClick: download,
      size: "sm",
      variant: "outline"
    }, "Download transcript")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), text ? /* @__PURE__ */ React.createElement(CodeBlock, {
      className: "meet-code",
      code: text,
      lang: meeting.transcriptFile || "text"
    }) : /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card"
    }, /* @__PURE__ */ React.createElement("p", {
      className: "meet-empty",
      role: "status"
    }, loaded ? ["queued", "joining", "transcribing"].includes(meeting.state) ? "Waiting for speech…" : "No speech was captured." : "Loading transcript…")));
  }
  function Page() {
    const [overview, setOverview] = React.useState(null);
    const [error, setError] = React.useState("");
    const [extensionConnected, setExtensionConnected] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [deleting, setDeleting] = React.useState(null);
    const [selected, setSelected] = React.useState(null);
    React.useEffect(() => {
      async function receive(event) {
        if (event.source !== window || event.origin !== window.location.origin) {
          return;
        }
        const data = event.data;
        if (data?.type === "NAKAMA_MEET_EXTENSION") {
          setExtensionConnected(data.connected === true);
          return;
        }
        if (data?.type !== "NAKAMA_MEET_ACTION" || typeof data.id !== "string" || !["meetings", "start-capture", "leave"].includes(data.action)) {
          return;
        }
        try {
          const result = await ctx.host.call(data.action, data.input);
          window.postMessage({ id: data.id, result, type: "NAKAMA_MEET_RESULT" }, window.location.origin);
        } catch (reason) {
          window.postMessage({ error: message(reason), id: data.id, type: "NAKAMA_MEET_RESULT" }, window.location.origin);
        }
      }
      window.addEventListener("message", receive);
      const ping = () => window.postMessage({ type: "NAKAMA_MEET_PING" }, window.location.origin);
      ping();
      const detectionTimeout = setTimeout(() => setExtensionConnected((connected) => connected ?? false), 1500);
      const timer = setInterval(ping, 3000);
      return () => {
        window.removeEventListener("message", receive);
        clearInterval(timer);
        clearTimeout(detectionTimeout);
      };
    }, []);
    React.useEffect(() => {
      let alive = true;
      let running = false;
      async function refresh() {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const result = await ctx.host.call("meetings");
          if (alive && !ctx.signal.aborted) {
            setOverview(result);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      }
      refresh();
      const timer = setInterval(() => void refresh(), 3000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);
    async function action(name, input) {
      setBusy(true);
      setError("");
      try {
        await ctx.host.call(name, input);
        setOverview(await ctx.host.call("meetings"));
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
    const groups = meetingGroups(overview?.meetings ?? []);
    if (selected) {
      return /* @__PURE__ */ React.createElement("section", {
        className: "meet-page"
      }, /* @__PURE__ */ React.createElement(Transcript, {
        close: () => setSelected(null),
        key: selected.id,
        meeting: overview?.meetings.find((meeting) => meeting.id === selected.id) ?? selected
      }));
    }
    return /* @__PURE__ */ React.createElement("section", {
      className: "meet-page"
    }, deleting && /* @__PURE__ */ React.createElement(ConfirmDialog, {
      description: "This meeting and its transcript will be deleted. You can’t get them back.",
      onClose: () => setDeleting(null),
      onConfirm: async () => {
        await ctx.host.call("delete", { meetingId: deleting.id });
        setOverview((previous) => previous ? {
          ...previous,
          meetings: previous.meetings.filter((meeting) => meeting.id !== deleting.id)
        } : previous);
      },
      title: "Delete meeting?"
    }), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading"
    }, /* @__PURE__ */ React.createElement("h2", null, "Transcription"), overview?.canConfigure && /* @__PURE__ */ React.createElement(Button, {
      render: /* @__PURE__ */ React.createElement("a", {
        href: "/customize/providers"
      }),
      size: "sm",
      variant: "outline"
    }, overview.configured ? "Manage OpenAI connection" : "Set up OpenAI")), /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading",
      style: { borderBottom: 0, borderTop: "1px solid var(--border)" }
    }, /* @__PURE__ */ React.createElement("span", {
      className: "meet-status",
      role: "status"
    }, overview ? overview.configured ? overview.worker.state === "ready" ? extensionConnected === null ? "Checking extension connection…" : extensionConnected ? "Connected. Start transcription from your Google Meet tab." : "Open the Chrome extension on this page and choose Connect." : "Start Google Meet in Workers." : "Connect OpenAI in AI Providers, then reinstall Google Meet to use the saved connection." : "Checking connection…"))), extensionConnected === false && /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card",
      style: { padding: 16 }
    }, /* @__PURE__ */ React.createElement(Button, {
      render: /* @__PURE__ */ React.createElement("a", {
        download: "nakama-google-meet-extension.zip",
        href: "/v1/plugins/official/google-meet/extension.zip"
      }),
      variant: "outline"
    }, "Download Chrome extension"), /* @__PURE__ */ React.createElement("ol", {
      style: {
        listStyleType: "decimal",
        marginTop: 12,
        paddingLeft: 20
      }
    }, /* @__PURE__ */ React.createElement("li", null, "Unzip the download."), /* @__PURE__ */ React.createElement("li", null, "Open ", /* @__PURE__ */ React.createElement("code", null, "chrome://extensions"), " and enable Developer mode."), /* @__PURE__ */ React.createElement("li", null, "Choose ", /* @__PURE__ */ React.createElement("strong", null, "Load unpacked"), " and select the unzipped folder."), /* @__PURE__ */ React.createElement("li", null, "Refresh this page, open the extension, and choose", " ", /* @__PURE__ */ React.createElement("strong", null, "Connect this Nakama tab"), "."))), overview ? /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading"
    }, /* @__PURE__ */ React.createElement("h2", null, "Meeting history"), /* @__PURE__ */ React.createElement("span", {
      className: "meet-status"
    }, overview.meetings.length)), !groups.length && /* @__PURE__ */ React.createElement("p", {
      className: "meet-empty"
    }, "Your meetings will appear here when you start transcribing."), /* @__PURE__ */ React.createElement("ul", {
      className: "meet-list"
    }, groups.flatMap((group) => group.meetings).map((meeting) => /* @__PURE__ */ React.createElement("li", {
      key: meeting.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-meeting"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-meta"
    }, /* @__PURE__ */ React.createElement("strong", null, "Meeting ·", " ", new Date(meeting.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })), /* @__PURE__ */ React.createElement("a", {
      className: "meet-link meet-status",
      href: meeting.url,
      rel: "noreferrer",
      target: "_blank"
    }, meeting.url.replace("https://", ""))), /* @__PURE__ */ React.createElement("div", {
      className: "meet-row"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "meet-badge"
    }, ["queued", "joining", "transcribing"].includes(meeting.state) ? meeting.stopRequested ? "Stopping…" : meeting.state === "transcribing" ? "Transcribing…" : "Connecting…" : meeting.state === "failed" ? meeting.transcriptFile ? "Partial transcript" : "Transcription failed" : meeting.transcriptFile ? "Transcript ready" : "No audio captured"), meeting.transcriptFile && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelected(meeting),
      size: "sm",
      variant: "outline"
    }, "View transcript"), ["queued", "joining", "transcribing"].includes(meeting.state) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !!meeting.stopRequested,
      onClick: () => void action("leave", {
        meetingId: meeting.id
      }),
      size: "sm",
      variant: "outline"
    }, "Stop transcription"), ["finished", "failed"].includes(meeting.state) && /* @__PURE__ */ React.createElement(Button, {
      "aria-label": "Delete meeting",
      disabled: busy,
      onClick: () => setDeleting(meeting),
      size: "icon-sm",
      title: "Delete meeting",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Delete02Icon, {
      "aria-hidden": true,
      size: 16
    })))), meeting.error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, meeting.error))))) : /* @__PURE__ */ React.createElement("p", null, "Loading…"));
  }
  ctx.slots.register("page", Page);
}
export {
  apply,
  inject,
  meetingGroups
};
