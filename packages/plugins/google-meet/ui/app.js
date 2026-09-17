// src/ui.tsx
var message = (error) => error instanceof Error ? error.message : "Request failed";
var inject = ["slots", "host", "styles", "ui"];
function apply(ctx) {
  const React = ctx.React;
  const {
    Button,
    Card,
    CodeBlock,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
  } = ctx.ui;
  ctx.styles(`
    .meet-page{display:grid;gap:32px;max-width:768px;width:100%;min-width:0;margin:0 auto;font-size:14px}
    .meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .meet-card{box-shadow:none;overflow:hidden}
    .meet-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .meet-page h2,.meet-page h3{font-size:14px;font-weight:500;margin:0}
    .meet-form{display:grid;gap:12px}
    .meet-form label{display:grid;gap:6px;font-size:14px;font-weight:500;min-width:0}
    .meet-join{padding:16px;grid-template-columns:minmax(0,1fr) 100px;align-items:end}
    .meet-join-footer{grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:4px}
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
    @media(max-width:480px){.meet-join{grid-template-columns:minmax(0,1fr)}.meet-join-footer>button{width:100%}}
    `);
  function Settings({ close }) {
    const [apiKey, setApiKey] = React.useState("");
    const [connection, setConnection] = React.useState(null);
    React.useEffect(() => {
      let alive = true;
      let running = false;
      const refresh = async () => {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const value = await ctx.host.call("connection");
          if (alive) {
            setConnection(value);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      };
      refresh();
      const timer = setInterval(() => void refresh(), 2000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);
    async function login(action) {
      setBusy(true);
      setError("");
      try {
        setConnection(await ctx.host.call(action));
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    async function save(event) {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        await ctx.host.call("configure", {
          apiKey: apiKey || undefined
        });
        setApiKey("");
        close();
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
    return /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!open) {
          close();
        }
      },
      open: true
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Google Meet settings")), /* @__PURE__ */ React.createElement("form", {
      className: "meet-form",
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("label", null, "OpenAI API key", /* @__PURE__ */ React.createElement(Input, {
      autoComplete: "off",
      onChange: (event) => setApiKey(event.target.value),
      placeholder: "Keep saved key",
      type: "password",
      value: apiKey
    })), /* @__PURE__ */ React.createElement("p", {
      className: "meet-status"
    }, "gpt-transcribe uses separate API billing. Your ChatGPT subscription does not cover transcription."), /* @__PURE__ */ React.createElement("div", {
      className: "meet-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || connection?.state === "starting" || connection?.state === "saving",
      onClick: () => void login("connect"),
      type: "button",
      variant: "outline"
    }, connection?.authenticated ? "Reconnect Google" : "Connect Google"), connection?.url && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("a", {
      href: connection.url,
      rel: "noreferrer noopener",
      target: "_blank"
    }, "Open sign-in browser"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || connection.state === "saving",
      onClick: () => void login("finish-login"),
      type: "button"
    }, "Finish sign-in")), (connection?.authenticated || connection?.url) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || connection.state === "saving",
      onClick: () => void login("disconnect"),
      type: "button",
      variant: "outline"
    }, "Disconnect Google")), /* @__PURE__ */ React.createElement("p", {
      className: "meet-status"
    }, connection?.state === "starting" ? "Starting browser…" : connection?.state === "saving" ? "Updating Google connection…" : connection?.url ? "Complete Google sign-in in the browser, then select Finish sign-in." : connection?.authenticated ? "Google connected" : "Google disconnected"), connection?.error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, connection.error), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      type: "submit"
    }, busy ? "Saving…" : "Save"))));
  }
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
    const [url, setUrl] = React.useState("");
    const [duration, setDuration] = React.useState(120);
    const [busy, setBusy] = React.useState(false);
    const [settings, setSettings] = React.useState(false);
    const [selected, setSelected] = React.useState(null);
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
    const active = overview?.meetings.some((meeting) => ["queued", "joining", "transcribing"].includes(meeting.state));
    const groups = [
      {
        meetings: overview?.meetings.filter((meeting) => !meeting.transcriptFile) ?? [],
        title: "Meetings"
      },
      {
        meetings: overview?.meetings.filter((meeting) => meeting.transcriptFile) ?? [],
        title: "Saved transcripts"
      }
    ];
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
    }, error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading"
    }, /* @__PURE__ */ React.createElement("h2", null, "Join a meeting"), overview?.canConfigure && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSettings(true),
      size: "sm",
      variant: "outline"
    }, "Settings")), /* @__PURE__ */ React.createElement("form", {
      className: "meet-form meet-join",
      onSubmit: (event) => {
        event.preventDefault();
        action("join", { durationMinutes: duration, url });
      }
    }, /* @__PURE__ */ React.createElement("label", null, "Meeting link", /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Google Meet URL",
      onChange: (event) => setUrl(event.target.value),
      placeholder: "https://meet.google.com/abc-defg-hij",
      required: true,
      type: "url",
      value: url
    })), /* @__PURE__ */ React.createElement("label", null, "Minutes", /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Maximum meeting minutes",
      max: 120,
      min: 1,
      onChange: (event) => setDuration(Number(event.target.value)),
      required: true,
      type: "number",
      value: duration
    })), /* @__PURE__ */ React.createElement("div", {
      className: "meet-join-footer"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || active || !overview?.configured || !overview.authenticated || overview.worker.state !== "ready",
      type: "submit"
    }, "Join and transcribe"))), /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading",
      style: { borderBottom: 0, borderTop: "1px solid var(--border)" }
    }, /* @__PURE__ */ React.createElement("span", {
      className: "meet-status",
      role: "status"
    }, overview ? overview.configured ? overview.authenticated ? overview.worker.state === "ready" ? "Ready to transcribe" : "Start Google Meet in Workers." : "Connect Google in Settings." : "Set a transcription API key in Settings." : "Checking connection…"))), overview ? groups.map((group) => /* @__PURE__ */ React.createElement("section", {
      key: group.title
    }, /* @__PURE__ */ React.createElement(Card, {
      className: "meet-card"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-card-heading"
    }, /* @__PURE__ */ React.createElement("h2", null, group.title), /* @__PURE__ */ React.createElement("span", {
      className: "meet-status"
    }, group.meetings.length)), group.meetings.length ? /* @__PURE__ */ React.createElement("ul", {
      className: "meet-list"
    }, group.meetings.map((meeting) => /* @__PURE__ */ React.createElement("li", {
      key: meeting.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-meeting"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-meta"
    }, /* @__PURE__ */ React.createElement("a", {
      className: "meet-link",
      href: meeting.url,
      rel: "noreferrer",
      target: "_blank"
    }, meeting.url.replace("https://", "")), /* @__PURE__ */ React.createElement("time", {
      className: "meet-status",
      dateTime: new Date(meeting.createdAt).toISOString()
    }, new Date(meeting.createdAt).toLocaleString())), /* @__PURE__ */ React.createElement("div", {
      className: "meet-row"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "meet-badge"
    }, meeting.state, meeting.stopRequested && ["queued", "joining", "transcribing"].includes(meeting.state) ? " · stopping" : ""), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelected(meeting),
      size: "sm",
      variant: "outline"
    }, meeting.transcriptFile ? "Open transcript" : "Transcript"), ["queued", "joining", "transcribing"].includes(meeting.state) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !!meeting.stopRequested,
      onClick: () => void action("leave", {
        meetingId: meeting.id
      }),
      size: "sm",
      variant: "outline"
    }, "Leave"))), meeting.error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, meeting.error)))) : /* @__PURE__ */ React.createElement("p", {
      className: "meet-empty"
    }, group.title === "Meetings" ? "No meetings yet." : "No saved transcripts yet.")))) : /* @__PURE__ */ React.createElement("p", null, "Loading…"), settings && /* @__PURE__ */ React.createElement(Settings, {
      close: () => setSettings(false)
    }));
  }
  ctx.slots.register("page", Page);
}
export {
  apply,
  inject
};
