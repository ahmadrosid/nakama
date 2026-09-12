// src/ui-editor.tsx
function createEditor(ctx) {
  const React = ctx.React;
  const { Button, Input, Textarea } = ctx.ui;
  return function Editor({ model }) {
    const {
      memory,
      busy,
      title,
      setTitle,
      readFile,
      content,
      setContent,
      source,
      setSource,
      readingFile,
      setEditing,
      save
    } = model;
    return /* @__PURE__ */ React.createElement("form", {
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
    }, "Close")));
  };
}

// src/ui-items.tsx
function createItems(ctx) {
  const React = ctx.React;
  const {
    Button,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
  } = ctx.ui;
  function ItemActions({
    item,
    model
  }) {
    const { busy, act, memory } = model;
    const [dialog, setDialog] = React.useState(null);
    const Action = memory ? Button : DropdownMenuItem;
    const controls = /* @__PURE__ */ React.createElement(React.Fragment, null, " ", /* @__PURE__ */ React.createElement(Action, {
      disabled: busy,
      onClick: () => {
        setDialog("delete");
      },
      variant: memory ? "ghost" : "destructive"
    }, item.state === "deleting" ? "Retry removal" : memory ? "Forget" : "Delete"), ["unknown", "pending", "submitting"].includes(item.state) && /* @__PURE__ */ React.createElement(Action, {
      disabled: busy,
      onClick: () => {
        act(item, false);
      }
    }, "Check status"));
    return /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!open) {
          setDialog(null);
        }
      },
      open: dialog === "delete"
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, memory ? "Forget memory?" : "Delete document?"), /* @__PURE__ */ React.createElement(DialogDescription, null, item.title, " will be removed from this agent’s", " ", memory ? "memory" : "knowledge", ".")), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setDialog(null),
      variant: "outline"
    }, "Cancel"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => {
        setDialog(null);
        act(item, true);
      },
      variant: "destructive"
    }, memory ? "Forget" : "Delete")))), memory ? controls : /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, {
      "aria-label": `Actions for ${item.title}`,
      disabled: busy,
      render: /* @__PURE__ */ React.createElement(Button, {
        size: "icon",
        variant: "ghost"
      })
    }, /* @__PURE__ */ React.createElement("span", {
      "aria-hidden": "true"
    }, "⋯")), /* @__PURE__ */ React.createElement(DropdownMenuContent, {
      align: "end"
    }, controls)));
  }
  function DocumentTable({ model }) {
    return /* @__PURE__ */ React.createElement("div", {
      className: "sm-table-wrap"
    }, /* @__PURE__ */ React.createElement("table", {
      "aria-label": "Knowledge documents",
      className: "sm-table"
    }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Name"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Source"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Status"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "sr-only"
    }, "Actions")))), /* @__PURE__ */ React.createElement("tbody", null, model.items.map((item) => /* @__PURE__ */ React.createElement("tr", {
      key: item.id
    }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("a", {
      className: "sm-document-name",
      href: `/plugins/supermemory?agent=${encodeURIComponent(model.agentId)}&document=${encodeURIComponent(item.id)}`
    }, item.title), item.excerpt && /* @__PURE__ */ React.createElement("p", {
      className: "sm-excerpt"
    }, item.excerpt)), /* @__PURE__ */ React.createElement("td", {
      className: "sm-source"
    }, item.source || "—"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", {
      className: "sm-document-status",
      "data-state": item.state
    }, item.state === "deleting" ? "Removal pending" : item.state)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(ItemActions, {
      item,
      model
    })))))));
  }
  return function Items({ model }) {
    const { loading, items, activeQuery, memory } = model;
    return loading ? /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Loading…") : items.length === 0 ? /* @__PURE__ */ React.createElement("p", {
      className: "sm-empty"
    }, activeQuery ? "No matching results" : memory ? "No memories yet" : "No documents yet") : memory ? /* @__PURE__ */ React.createElement("ul", {
      className: "sm-list"
    }, items.map((item) => /* @__PURE__ */ React.createElement("li", {
      className: "sm-item",
      key: item.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, /* @__PURE__ */ React.createElement("strong", {
      className: "sm-title"
    }, item.title), /* @__PURE__ */ React.createElement("span", null, item.state === "deleting" ? "Removal pending" : item.state)), item.excerpt && /* @__PURE__ */ React.createElement("p", {
      className: "sm-excerpt"
    }, item.excerpt), item.source && /* @__PURE__ */ React.createElement("p", {
      className: "sm-source"
    }, item.source), /* @__PURE__ */ React.createElement(ItemActions, {
      item,
      model
    })))) : /* @__PURE__ */ React.createElement(DocumentTable, {
      model
    });
  };
}

// src/ui-context.ts
var errorText = (error) => error instanceof Error ? error.message : "Request failed";

// src/use-collection.ts
function useCollection(ctx, agentId, kind) {
  const React = ctx.React;
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
  return {
    act,
    activeQuery,
    agentId,
    busy,
    content,
    editing,
    error,
    hasMore,
    items,
    loading,
    memory,
    page,
    query,
    readFile,
    readingFile,
    save,
    setActiveQuery,
    setContent,
    setEditing,
    setError,
    setPage,
    setQuery,
    setRevision,
    setSource,
    setTitle,
    source,
    title
  };
}

// src/ui-collection.tsx
function createCollection(ctx) {
  const React = ctx.React;
  const { Button, Input } = ctx.ui;
  const Editor = createEditor(ctx);
  const Items = createItems(ctx);
  function Collection({
    agentId,
    kind,
    toolbar,
    tabs
  }) {
    const model = useCollection(ctx, agentId, kind);
    const {
      memory,
      query,
      setQuery,
      activeQuery,
      setActiveQuery,
      page,
      setPage,
      hasMore,
      busy,
      error,
      setError,
      editing,
      setEditing,
      setRevision
    } = model;
    return /* @__PURE__ */ React.createElement("div", {
      className: "sm-stack"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "sm-row sm-toolbar"
    }, toolbar, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setEditing(true)
    }, memory ? "Add memory" : "Add text")), tabs, /* @__PURE__ */ React.createElement("div", {
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
      onClick: () => {
        setError("");
        setRevision((value) => value + 1);
      },
      variant: "ghost"
    }, "Refresh")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), editing && /* @__PURE__ */ React.createElement(Editor, {
      model
    }), /* @__PURE__ */ React.createElement(Items, {
      model
    }), !activeQuery && (page > 1 || hasMore) && /* @__PURE__ */ React.createElement("div", {
      className: "sm-row sm-pagination"
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
  return Collection;
}

// src/ui-browser.tsx
function createBrowser(ctx) {
  const React = ctx.React;
  const {
    Button,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem
  } = ctx.ui;
  const Collection = createCollection(ctx);
  function DocumentPage({
    agentId,
    documentId
  }) {
    const [document2, setDocument] = React.useState(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      let active = true;
      ctx.host.call("get_document", { agentId, id: documentId }).then((result) => {
        if (active) {
          setDocument(result);
        }
      }).catch((reason) => {
        if (active) {
          setError(errorText(reason));
        }
      });
      return () => {
        active = false;
      };
    }, [agentId, documentId]);
    return /* @__PURE__ */ React.createElement("article", {
      className: "sm-stack"
    }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Button, {
      render: /* @__PURE__ */ React.createElement("a", {
        "aria-label": "Back to Knowledge",
        href: `/plugins/supermemory?agent=${encodeURIComponent(agentId)}&tab=knowledge`
      }),
      variant: "ghost"
    }, "← Back to Knowledge")), error ? /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error) : document2 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h1", {
      style: {
        fontSize: "24px",
        fontWeight: 600,
        overflowWrap: "anywhere"
      }
    }, document2.title), document2.source && /* @__PURE__ */ React.createElement("p", {
      className: "sm-source"
    }, document2.source), /* @__PURE__ */ React.createElement("div", {
      style: {
        lineHeight: 1.7,
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap"
      }
    }, document2.content ?? "Content is not available yet.")) : /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Loading…"));
  }
  return function Browser({
    profiles,
    controls
  }) {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const requestedAgent = params.get("agent");
    const documentId = params.get("document");
    const [agentId, setAgentId] = React.useState(profiles.find((profile) => profile.id === requestedAgent)?.id ?? profiles[0]?.id ?? "");
    const [kind, setKind] = React.useState(params.get("tab") === "knowledge" ? "knowledge" : "memory");
    if (documentId) {
      return /* @__PURE__ */ React.createElement(DocumentPage, {
        agentId: requestedAgent ?? agentId,
        documentId,
        key: `${requestedAgent}:${documentId}`
      });
    }
    const selector = /* @__PURE__ */ React.createElement(Select, {
      onValueChange: (value) => setAgentId(value ?? ""),
      value: agentId
    }, /* @__PURE__ */ React.createElement(SelectTrigger, {
      "aria-label": "Agent"
    }, /* @__PURE__ */ React.createElement(SelectValue, {
      placeholder: "Choose agent"
    }, profiles.find((profile) => profile.id === agentId)?.name)), /* @__PURE__ */ React.createElement(SelectContent, null, profiles.map((profile) => /* @__PURE__ */ React.createElement(SelectItem, {
      key: profile.id,
      value: profile.id
    }, profile.name))));
    const tabs = /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Collection",
      className: "sm-tabs",
      role: "group"
    }, /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": kind === "memory",
      className: "sm-tab",
      onClick: () => setKind("memory"),
      variant: "ghost"
    }, "Memory"), /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": kind === "knowledge",
      className: "sm-tab",
      onClick: () => setKind("knowledge"),
      variant: "ghost"
    }, "Knowledge"));
    return /* @__PURE__ */ React.createElement(React.Fragment, null, agentId ? /* @__PURE__ */ React.createElement(Collection, {
      agentId,
      key: `${agentId}:${kind}`,
      kind,
      tabs,
      toolbar: /* @__PURE__ */ React.createElement(React.Fragment, null, selector, controls)
    }) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
      className: "sm-row"
    }, selector, controls), /* @__PURE__ */ React.createElement("p", {
      className: "sm-empty"
    }, "No agents available")));
  };
}

// src/ui-settings.tsx
function createSettings(ctx) {
  const React = ctx.React;
  const { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle } = ctx.ui;
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
  return Settings;
}

// src/ui-page.tsx
function usePage(ctx) {
  const React = ctx.React;
  const [profiles, setProfiles] = React.useState([]);
  const [canConfigure, setCanConfigure] = React.useState(false);
  const [configured, setConfigured] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const [worker, setWorker] = React.useState(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight || !alive || ctx.signal.aborted) {
        return;
      }
      inFlight = true;
      return ctx.host.call("profiles").then((value) => {
        if (!alive || ctx.signal.aborted) {
          return;
        }
        const result = value;
        setError("");
        setWorker(result.worker ?? null);
        setProfiles(result.profiles);
        setConfigured(result.configured);
        setCanConfigure(result.canConfigure);
      }).catch((reason) => {
        if (alive) {
          setError(errorText(reason));
        }
      }).finally(() => {
        inFlight = false;
        if (alive) {
          setLoading(false);
        }
      });
    };
    refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      clearInterval(timer);
      alive = false;
    };
  }, []);
  return {
    canConfigure,
    configured,
    error,
    loading,
    profiles,
    setConfigured,
    setSettings,
    settings,
    worker
  };
}
function createPage(ctx) {
  const React = ctx.React;
  const { Button } = ctx.ui;
  const Settings = createSettings(ctx);
  const Browser = createBrowser(ctx);
  function Page() {
    const {
      profiles,
      worker,
      canConfigure,
      configured,
      setConfigured,
      settings,
      setSettings,
      error,
      loading
    } = usePage(ctx);
    const controls = /* @__PURE__ */ React.createElement("div", {
      className: "sm-row sm-controls"
    }, configured && /* @__PURE__ */ React.createElement("span", {
      className: "sm-ready"
    }, "Ready"), canConfigure && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSettings(true),
      variant: "ghost"
    }, "Settings"));
    return /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Supermemory",
      className: "sm-page sm-stack"
    }, !configured && controls, error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), loading ? /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Loading…") : configured ? /* @__PURE__ */ React.createElement(Browser, {
      controls,
      profiles
    }) : /* @__PURE__ */ React.createElement("div", {
      className: "sm-stack"
    }, /* @__PURE__ */ React.createElement("p", {
      role: worker?.state === "error" ? "alert" : "status"
    }, worker?.message || (worker?.state === "stopped" ? "Supermemory is stopped." : "Preparing Supermemory…")), /* @__PURE__ */ React.createElement("a", {
      href: "/workers"
    }, "Open Workers")), settings && /* @__PURE__ */ React.createElement(Settings, {
      close: () => setSettings(false),
      saved: () => {
        setConfigured(true);
        setSettings(false);
      }
    }));
  }
  return Page;
}

// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
function apply(ctx) {
  ctx.styles('.sm-page{margin:0;padding:0;width:100%;box-sizing:border-box}.sm-stack{display:flex;flex-direction:column;gap:16px}.sm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sm-title{flex:1;min-width:0;overflow-wrap:anywhere}.sm-toolbar{gap:12px}.sm-toolbar>[role=combobox]{width:auto;min-width:160px;max-width:100%}.sm-controls{margin-left:auto}.sm-ready{font-size:12px;color:var(--muted-foreground);display:inline-flex;align-items:center;gap:6px}.sm-ready:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--color-emerald-500,#10b981)}.sm-tabs{display:flex;gap:20px;border-bottom:1px solid var(--border)}.sm-page .sm-tab{border-radius:0;border-bottom:2px solid transparent;padding:10px 0;height:auto;background:transparent;color:var(--muted-foreground)}.sm-page .sm-tab[aria-pressed=true]{border-bottom-color:var(--foreground);color:var(--foreground)}.sm-empty{padding:40px 0;text-align:center;color:var(--muted-foreground);font-size:14px}.sm-pagination{justify-content:flex-end;font-size:13px}.sm-search{display:flex;gap:8px;flex:1;min-width:180px}.sm-card{border:1px solid var(--border);border-radius:10px;padding:16px}.sm-list{list-style:none;margin:0;padding:0}.sm-item{padding:16px 0;border-bottom:1px solid var(--border)}.sm-item:first-child{border-top:1px solid var(--border)}.sm-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.sm-source{font-size:13px;overflow-wrap:anywhere;opacity:.7}.sm-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px}.sm-table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}.sm-table th{font-weight:500;color:var(--muted-foreground);font-size:12px}.sm-table th,.sm-table td{padding:12px 16px;vertical-align:middle}.sm-table thead,.sm-table tbody tr:not(:last-child){border-bottom:1px solid var(--border)}.sm-table th:first-child{width:100%}.sm-table td:first-child{min-width:220px;overflow-wrap:anywhere}.sm-document-name{font-weight:500;text-decoration:none;color:inherit}.sm-document-name:hover{text-decoration:underline}.sm-document-name:focus-visible{outline:2px solid var(--ring);outline-offset:4px}.sm-table .sm-source{white-space:nowrap;overflow-wrap:normal}.sm-table tbody tr:hover{background:var(--muted)}.sm-table .sm-excerpt{font-size:13px;color:var(--muted-foreground);margin:6px 0 0}.sm-table td:last-child{width:56px;padding:8px 12px}.sm-table td:last-child .sm-row{justify-content:flex-end}.sm-table .sm-excerpt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.sm-document-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-transform:capitalize;font-size:12px;color:var(--muted-foreground)}.sm-document-status:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.sm-document-status[data-state=ready]{color:var(--color-emerald-500,#10b981)}.sm-stack label{display:grid;gap:6px}@media(max-width:600px){.sm-toolbar{gap:8px}.sm-search{flex-basis:100%}}');
  ctx.slots.register("page", createPage(ctx));
}
export {
  apply,
  inject
};
