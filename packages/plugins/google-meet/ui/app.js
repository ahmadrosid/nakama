// src/ui.tsx
var message = (error) => error instanceof Error ? error.message : "Request failed";
var inject = ["slots", "host", "styles", "ui"];
function apply(ctx) {
  const React = ctx.React;
  const { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle } = ctx.ui;
  ctx.styles(".meet-page{display:grid;gap:16px;max-width:960px;width:100%;min-width:0}.meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.meet-form{display:grid;gap:12px}.meet-form label{display:grid;gap:6px}.meet-list{list-style:none;padding:0;margin:0}.meet-list li{padding:16px 0;border-bottom:1px solid var(--border)}.meet-transcript{white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto}.meet-url{flex:1;min-width:180px}.meet-status{font-size:13px;color:var(--muted-foreground)}");
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
    return /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!open) {
          close();
        }
      },
      open: true
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Meeting transcript")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement("div", {
      className: "meet-transcript"
    }, text || "Waiting for speech…"), /* @__PURE__ */ React.createElement(Button, {
      disabled: !text,
      onClick: download
    }, "Download transcript")));
  }
  function Page() {
    const [overview, setOverview] = React.useState(null);
    const [error, setError] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [duration, setDuration] = React.useState(30);
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
    return /* @__PURE__ */ React.createElement("section", {
      className: "meet-page"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-row"
    }, /* @__PURE__ */ React.createElement("h1", null, "Google Meet"), overview?.canConfigure && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSettings(true),
      variant: "outline"
    }, "Settings")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), overview && /* @__PURE__ */ React.createElement("p", {
      className: "meet-status"
    }, overview.configured ? overview.authenticated ? overview.worker.state === "ready" ? "Ready" : "Start Google Meet in Workers." : "Connect Google in Settings." : "Set a transcription API key in Settings."), /* @__PURE__ */ React.createElement("form", {
      className: "meet-row",
      onSubmit: (event) => {
        event.preventDefault();
        action("join", { durationMinutes: duration, url });
      }
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Google Meet URL",
      className: "meet-url",
      onChange: (event) => setUrl(event.target.value),
      placeholder: "https://meet.google.com/abc-defg-hij",
      required: true,
      type: "url",
      value: url
    }), /* @__PURE__ */ React.createElement("label", null, "Minutes", " ", /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Maximum meeting minutes",
      max: 55,
      min: 1,
      onChange: (event) => setDuration(Number(event.target.value)),
      style: { width: 90 },
      type: "number",
      value: duration
    })), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || active || !overview?.configured || !overview.authenticated || overview.worker.state !== "ready",
      type: "submit"
    }, "Join and transcribe")), overview ? overview.meetings.length ? /* @__PURE__ */ React.createElement("ul", {
      className: "meet-list"
    }, overview.meetings.map((meeting) => /* @__PURE__ */ React.createElement("li", {
      key: meeting.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "meet-row"
    }, /* @__PURE__ */ React.createElement("a", {
      href: meeting.url,
      rel: "noreferrer",
      target: "_blank"
    }, meeting.url), /* @__PURE__ */ React.createElement("span", {
      className: "meet-status"
    }, meeting.state, meeting.stopRequested && ["queued", "joining", "transcribing"].includes(meeting.state) ? " · stopping" : ""), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelected(meeting),
      variant: "outline"
    }, "Transcript"), ["queued", "joining", "transcribing"].includes(meeting.state) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !!meeting.stopRequested,
      onClick: () => void action("leave", { meetingId: meeting.id }),
      variant: "outline"
    }, "Leave")), meeting.error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, meeting.error)))) : /* @__PURE__ */ React.createElement("p", null, "No meetings yet.") : /* @__PURE__ */ React.createElement("p", null, "Loading…"), settings && /* @__PURE__ */ React.createElement(Settings, {
      close: () => setSettings(false)
    }), selected && /* @__PURE__ */ React.createElement(Transcript, {
      close: () => setSelected(null),
      meeting: selected
    }));
  }
  ctx.slots.register("page", Page);
}
export {
  apply,
  inject
};
