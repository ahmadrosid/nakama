// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
function apply(ctx) {
  const React = ctx.React;
  const {
    Button,
    Input,
    Textarea,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
  } = ctx.ui;
  const errorText = (error) => error instanceof Error ? error.message : "Request failed";
  function Settings({
    close,
    saved
  }) {
    const [url, setUrl] = React.useState("");
    const [token, setToken] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
      let alive = true;
      ctx.host.call("get_settings").then((value) => {
        if (alive) {
          setUrl(value.url);
        }
      }).catch((error) => {
        if (alive) {
          setMessage(errorText(error));
        }
      });
      return () => {
        alive = false;
      };
    }, []);
    async function save(event) {
      event.preventDefault();
      setBusy(true);
      setMessage("");
      try {
        await ctx.host.call("save_settings", {
          token: token || undefined,
          url
        });
        setToken("");
        saved();
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        setBusy(false);
      }
    }
    async function check() {
      setBusy(true);
      setMessage("");
      try {
        await ctx.host.call("check_connection");
        setMessage("Connected to saved server");
      } catch (error) {
        setMessage(errorText(error));
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
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Supermemory settings")), /* @__PURE__ */ React.createElement("form", {
      className: "sm-stack",
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("label", null, "Server URL", /* @__PURE__ */ React.createElement(Input, {
      onChange: (event) => setUrl(event.target.value),
      placeholder: "http://localhost:6767",
      required: true,
      value: url
    })), /* @__PURE__ */ React.createElement("label", null, "API token", /* @__PURE__ */ React.createElement(Input, {
      autoComplete: "new-password",
      onChange: (event) => setToken(event.target.value),
      type: "password",
      value: token
    })), /* @__PURE__ */ React.createElement("p", null, "Leave the token blank to keep it for the same server."), message && /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, message), /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      type: "submit"
    }, "Save"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: check,
      type: "button",
      variant: "outline"
    }, "Check saved connection")))));
  }
  function Collection({
    agentId,
    kind
  }) {
    const memory = kind === "memory";
    const actions = memory ? {
      list: "list_memories",
      refresh: "list_memories",
      remove: "forget_memory",
      save: "remember",
      search: "search_memory"
    } : {
      list: "list_documents",
      refresh: "get_document",
      remove: "delete_document",
      save: "add_document",
      search: "search_knowledge"
    };
    const [visible, setVisible] = React.useState(typeof document === "undefined" || !document.hidden);
    React.useEffect(() => {
      if (typeof document === "undefined") {
        return;
      }
      const changed = () => setVisible(!document.hidden);
      document.addEventListener("visibilitychange", changed);
      return () => document.removeEventListener("visibilitychange", changed);
    }, []);
    const [items, setItems] = React.useState([]);
    const [query, setQuery] = React.useState("");
    const [activeQuery, setActiveQuery] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [hasMore, setHasMore] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [editing, setEditing] = React.useState(false);
    const [content, setContent] = React.useState("");
    const [title, setTitle] = React.useState("");
    const [source, setSource] = React.useState("");
    const [revision, setRevision] = React.useState(0);
    const alive = React.useRef(true);
    const submission = React.useRef({ key: "", payload: "" });
    const fileRead = React.useRef(0);
    const [readingFile, setReadingFile] = React.useState(false);
    React.useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);
    React.useEffect(() => {
      let current = true;
      setLoading(true);
      const action = activeQuery ? actions.search : actions.list;
      ctx.host.call(action, {
        agentId,
        ...activeQuery ? { query: activeQuery } : { page }
      }).then((value) => {
        if (!current || ctx.signal.aborted) {
          return;
        }
        const result = value;
        setItems(result.items);
        setHasMore(!!result.hasMore);
      }).catch((reason) => {
        if (current) {
          setError(errorText(reason));
          setItems([]);
        }
      }).finally(() => {
        if (current) {
          setLoading(false);
        }
      });
      return () => {
        current = false;
      };
    }, [agentId, activeQuery, page, actions.search, actions.list, revision]);
    React.useEffect(() => {
      if (!visible || memory || activeQuery || error || busy || loading) {
        return;
      }
      const pending = items.find((item) => ["pending", "submitting"].includes(item.state));
      if (!pending) {
        return;
      }
      let current = true;
      const timer = setTimeout(async () => {
        if (ctx.signal.aborted) {
          return;
        }
        try {
          const item = await ctx.host.call("get_document", {
            agentId,
            id: pending.id
          });
          if (current) {
            setItems((previous) => previous.map((row) => row.id === item.id ? item : row));
          }
        } catch (reason) {
          if (current) {
            setError(errorText(reason));
          }
        }
      }, 5000);
      return () => {
        current = false;
        clearTimeout(timer);
      };
    }, [items, agentId, memory, activeQuery, error, busy, loading, visible]);
    async function save(event) {
      event.preventDefault();
      if (busy || readingFile) {
        return;
      }
      setBusy(true);
      setError("");
      const payload = JSON.stringify({
        agentId,
        content,
        source: source || undefined,
        title: memory ? undefined : title
      });
      if (submission.current.payload !== payload) {
        submission.current = { key: crypto.randomUUID(), payload };
      }
      try {
        const result = await ctx.host.call(actions.save, {
          ...JSON.parse(payload),
          submissionKey: submission.current.key
        });
        if (!alive.current || ctx.signal.aborted) {
          return;
        }
        if (["unknown", "submitting"].includes(result.state)) {
          setError(result.message ?? "Save outcome unresolved. Retry to check the same submission.");
        } else {
          setEditing(false);
          setContent("");
          setTitle("");
          setSource("");
          submission.current = { key: "", payload: "" };
        }
        setActiveQuery("");
        setQuery("");
        setPage(1);
        setRevision((value) => value + 1);
      } catch (reason) {
        if (alive.current) {
          setError(errorText(reason));
        }
      } finally {
        if (alive.current) {
          setBusy(false);
        }
      }
    }
    async function act(item, remove) {
      if (busy || readingFile) {
        return;
      }
      setBusy(true);
      setError("");
      try {
        const action = remove ? actions.remove : actions.refresh;
        const result = await ctx.host.call(action, {
          agentId,
          id: item.id
        });
        if (!alive.current || ctx.signal.aborted) {
          return;
        }
        const updated = result.items?.[0] ?? result;
        setItems((previous) => previous.flatMap((row) => row.id === item.id ? ["deleted", "forgotten"].includes(updated.state) ? [] : [updated] : [row]));
        if (updated.message) {
          setError(updated.message);
        }
      } catch (reason) {
        if (alive.current) {
          setError(errorText(reason));
        }
      } finally {
        if (alive.current) {
          setBusy(false);
        }
      }
    }
    async function readFile(file) {
      const generation = ++fileRead.current;
      if (!file) {
        setReadingFile(false);
        return;
      }
      setReadingFile(true);
      try {
        if (!/\.(txt|md)$/i.test(file.name) || file.size > 262144) {
          throw new Error("Choose a .txt or .md file up to 256 KiB");
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (alive.current && generation === fileRead.current) {
          setContent(text);
          setTitle(file.name);
        }
      } catch (reason) {
        if (alive.current && generation === fileRead.current) {
          setError(errorText(reason));
        }
      } finally {
        if (alive.current && generation === fileRead.current) {
          setReadingFile(false);
        }
      }
    }
    return /* @__PURE__ */ React.createElement("div", {
      className: "sm-stack"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement("form", {
      className: "sm-search",
      onSubmit: (event) => {
        event.preventDefault();
        setPage(1);
        setActiveQuery(query.trim());
        setRevision((value) => value + 1);
      }
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": memory ? "Search memories" : "Search knowledge",
      onChange: (event) => setQuery(event.target.value),
      placeholder: memory ? "Search memories" : "Search knowledge",
      value: query
    }), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      type: "submit",
      variant: "outline"
    }, "Search")), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setEditing(true)
    }, memory ? "Remember" : "Add text"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => {
        setError("");
        setRevision((value) => value + 1);
      },
      variant: "ghost"
    }, "Refresh")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), editing && /* @__PURE__ */ React.createElement("form", {
      className: "sm-card sm-stack",
      onSubmit: save
    }, !memory && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "Title", /* @__PURE__ */ React.createElement(Input, {
      disabled: busy,
      maxLength: 200,
      onChange: (event) => setTitle(event.target.value),
      required: true,
      value: title
    })), /* @__PURE__ */ React.createElement("label", null, "Text file", /* @__PURE__ */ React.createElement(Input, {
      accept: ".txt,.md,text/plain,text/markdown",
      disabled: busy,
      onChange: (event) => {
        readFile(event.target.files?.[0]);
      },
      type: "file"
    }))), /* @__PURE__ */ React.createElement("label", null, memory ? "Fact to remember" : "Content", /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      maxLength: memory ? 1e4 : 262144,
      onChange: (event) => setContent(event.target.value),
      required: true,
      rows: 6,
      value: content
    })), /* @__PURE__ */ React.createElement("label", null, "Source (optional)", /* @__PURE__ */ React.createElement(Input, {
      disabled: busy,
      maxLength: 2048,
      onChange: (event) => setSource(event.target.value),
      value: source
    })), /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || readingFile,
      type: "submit"
    }, busy ? "Saving…" : "Save"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setEditing(false),
      type: "button",
      variant: "ghost"
    }, "Close"))), loading ? /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Loading…") : items.length === 0 ? /* @__PURE__ */ React.createElement("p", null, activeQuery ? "No matching results" : memory ? "No memories yet" : "No documents yet") : /* @__PURE__ */ React.createElement("ul", {
      className: "sm-list"
    }, items.map((item) => /* @__PURE__ */ React.createElement("li", {
      className: "sm-card",
      key: item.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement("strong", {
      className: "sm-title"
    }, item.title), /* @__PURE__ */ React.createElement("span", null, item.state === "deleting" ? "Removal pending" : item.state)), item.excerpt && /* @__PURE__ */ React.createElement("p", {
      className: "sm-excerpt"
    }, item.excerpt), item.source && /* @__PURE__ */ React.createElement("p", {
      className: "sm-source"
    }, item.source), /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => {
        act(item, true);
      },
      variant: "ghost"
    }, item.state === "deleting" ? "Retry removal" : memory ? "Forget" : "Delete"), ["unknown", "pending", "submitting"].includes(item.state) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => {
        act(item, false);
      },
      variant: "outline"
    }, "Check status"))))), !activeQuery && /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: page === 1 || busy,
      onClick: () => setPage((value) => value - 1),
      variant: "ghost"
    }, "Previous"), /* @__PURE__ */ React.createElement("span", null, "Page ", page), /* @__PURE__ */ React.createElement(Button, {
      disabled: !hasMore || busy,
      onClick: () => setPage((value) => value + 1),
      variant: "ghost"
    }, "Next")));
  }
  function Page() {
    const [profiles, setProfiles] = React.useState([]);
    const [agentId, setAgentId] = React.useState("");
    const [kind, setKind] = React.useState("memory");
    const [canConfigure, setCanConfigure] = React.useState(false);
    const [configured, setConfigured] = React.useState(false);
    const [settings, setSettings] = React.useState(false);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => {
      let alive = true;
      ctx.host.call("profiles").then((value) => {
        if (!alive || ctx.signal.aborted) {
          return;
        }
        const result = value;
        setProfiles(result.profiles);
        setAgentId(result.profiles[0]?.id ?? "");
        setConfigured(result.configured);
        setCanConfigure(result.canConfigure);
      }).catch((reason) => {
        if (alive) {
          setError(errorText(reason));
        }
      }).finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
      return () => {
        alive = false;
      };
    }, []);
    return /* @__PURE__ */ React.createElement("section", {
      className: "sm-page sm-stack"
    }, /* @__PURE__ */ React.createElement("header", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement("h1", {
      className: "sm-title"
    }, "Supermemory"), configured && /* @__PURE__ */ React.createElement("span", null, "Configured"), canConfigure && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSettings(true),
      variant: "outline"
    }, "Settings")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), loading ? /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Loading…") : configured ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Select, {
      onValueChange: (value) => setAgentId(value ?? ""),
      value: agentId
    }, /* @__PURE__ */ React.createElement(SelectTrigger, {
      "aria-label": "Agent"
    }, /* @__PURE__ */ React.createElement(SelectValue, {
      placeholder: "Choose agent"
    })), /* @__PURE__ */ React.createElement(SelectContent, null, profiles.map((profile) => /* @__PURE__ */ React.createElement(SelectItem, {
      key: profile.id,
      value: profile.id
    }, profile.name)))), /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Collection",
      className: "sm-row",
      role: "group"
    }, /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": kind === "memory",
      onClick: () => setKind("memory"),
      variant: kind === "memory" ? "default" : "ghost"
    }, "Memory"), /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": kind === "knowledge",
      onClick: () => setKind("knowledge"),
      variant: kind === "knowledge" ? "default" : "ghost"
    }, "Knowledge")), agentId ? /* @__PURE__ */ React.createElement(Collection, {
      agentId,
      key: `${agentId}:${kind}`,
      kind
    }) : /* @__PURE__ */ React.createElement("p", null, "No agents available")) : /* @__PURE__ */ React.createElement("p", null, canConfigure ? "Connect your Supermemory server in Settings." : "Ask an admin to connect Supermemory."), settings && /* @__PURE__ */ React.createElement(Settings, {
      close: () => setSettings(false),
      saved: () => {
        setConfigured(true);
        setSettings(false);
      }
    }));
  }
  ctx.styles(".sm-page{max-width:960px;margin:0 auto;padding:24px;width:100%;box-sizing:border-box}.sm-stack{display:flex;flex-direction:column;gap:16px}.sm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sm-title{flex:1;min-width:0;overflow-wrap:anywhere}.sm-page h1{font-size:24px;font-weight:600}.sm-search{display:flex;gap:8px;flex:1;min-width:180px}.sm-card{border:1px solid var(--border);border-radius:10px;padding:16px}.sm-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}.sm-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.sm-source{font-size:13px;overflow-wrap:anywhere;opacity:.7}.sm-stack label{display:grid;gap:6px}@media(max-width:600px){.sm-page{padding:16px}.sm-search{flex-basis:100%}}");
  ctx.slots.register("page", Page);
}
export {
  apply,
  inject
};
