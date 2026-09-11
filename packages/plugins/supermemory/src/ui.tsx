/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as UI from "@nakama/ui";
import type * as ReactType from "react";

type Item = {
  id: string;
  title: string;
  source: string;
  state: string;
  excerpt?: string;
  message?: string;
};
type Profile = { id: string; name: string };
type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
};
export const inject = ["slots", "host", "styles", "ui"];

export function apply(ctx: Context) {
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
    DialogTitle,
  } = ctx.ui;
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : "Request failed";
  function Settings({
    close,
    saved,
  }: {
    close: () => void;
    saved: () => void;
  }) {
    const [url, setUrl] = React.useState("");
    const [token, setToken] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
      let alive = true;
      ctx.host
        .call("get_settings")
        .then((value) => {
          if (alive) {
            setUrl((value as { url: string }).url);
          }
        })
        .catch((error) => {
          if (alive) {
            setMessage(errorText(error));
          }
        });
      return () => {
        alive = false;
      };
    }, []);
    async function save(event: ReactType.FormEvent) {
      event.preventDefault();
      setBusy(true);
      setMessage("");
      try {
        await ctx.host.call("save_settings", {
          token: token || undefined,
          url,
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
    return (
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        open
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supermemory settings</DialogTitle>
          </DialogHeader>
          <form className="sm-stack" onSubmit={save}>
            <label>
              Server URL
              <Input
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://localhost:6767"
                required
                value={url}
              />
            </label>
            <label>
              API token
              <Input
                autoComplete="new-password"
                onChange={(event) => setToken(event.target.value)}
                type="password"
                value={token}
              />
            </label>
            <p>Leave the token blank to keep it for the same server.</p>
            {message && <p role="status">{message}</p>}
            <div className="sm-row">
              <Button disabled={busy} type="submit">
                Save
              </Button>
              <Button
                disabled={busy}
                onClick={check}
                type="button"
                variant="outline"
              >
                Check saved connection
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
  function Collection({
    agentId,
    kind,
  }: {
    agentId: string;
    kind: "memory" | "knowledge";
  }) {
    const memory = kind === "memory";
    const actions = memory
      ? {
          list: "list_memories",
          refresh: "list_memories",
          remove: "forget_memory",
          save: "remember",
          search: "search_memory",
        }
      : {
          list: "list_documents",
          refresh: "get_document",
          remove: "delete_document",
          save: "add_document",
          search: "search_knowledge",
        };
    const [visible, setVisible] = React.useState(
      typeof document === "undefined" || !document.hidden
    );
    React.useEffect(() => {
      if (typeof document === "undefined") {
        return;
      }
      const changed = () => setVisible(!document.hidden);
      document.addEventListener("visibilitychange", changed);
      return () => document.removeEventListener("visibilitychange", changed);
    }, []);
    const [items, setItems] = React.useState<Item[]>([]);
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
      ctx.host
        .call(action, {
          agentId,
          ...(activeQuery ? { query: activeQuery } : { page }),
        })
        .then((value) => {
          if (!current || ctx.signal.aborted) {
            return;
          }
          const result = value as { items: Item[]; hasMore?: boolean };
          setItems(result.items);
          setHasMore(!!result.hasMore);
        })
        .catch((reason) => {
          if (current) {
            setError(errorText(reason));
            setItems([]);
          }
        })
        .finally(() => {
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
      const pending = items.find((item) =>
        ["pending", "submitting"].includes(item.state)
      );
      if (!pending) {
        return;
      }
      let current = true;
      const timer = setTimeout(async () => {
        if (ctx.signal.aborted) {
          return;
        }
        try {
          const item = (await ctx.host.call("get_document", {
            agentId,
            id: pending.id,
          })) as Item;
          if (current) {
            setItems((previous) =>
              previous.map((row) => (row.id === item.id ? item : row))
            );
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
    async function save(event: ReactType.FormEvent) {
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
        title: memory ? undefined : title,
      });
      if (submission.current.payload !== payload) {
        submission.current = { key: crypto.randomUUID(), payload };
      }
      try {
        const result = (await ctx.host.call(actions.save, {
          ...JSON.parse(payload),
          submissionKey: submission.current.key,
        })) as Item;
        if (!alive.current || ctx.signal.aborted) {
          return;
        }
        if (["unknown", "submitting"].includes(result.state)) {
          setError(
            result.message ??
              "Save outcome unresolved. Retry to check the same submission."
          );
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
    async function act(item: Item, remove: boolean) {
      if (busy || readingFile) {
        return;
      }
      setBusy(true);
      setError("");
      try {
        const action = remove ? actions.remove : actions.refresh;
        const result = (await ctx.host.call(action, {
          agentId,
          id: item.id,
        })) as Item & { items?: Item[] };
        if (!alive.current || ctx.signal.aborted) {
          return;
        }
        const updated = result.items?.[0] ?? result;
        setItems((previous) =>
          previous.flatMap((row) =>
            row.id === item.id
              ? ["deleted", "forgotten"].includes(updated.state)
                ? []
                : [updated]
              : [row]
          )
        );
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
    async function readFile(file?: File) {
      const generation = ++fileRead.current;
      if (!file) {
        setReadingFile(false);
        return;
      }
      setReadingFile(true);
      try {
        if (!/\.(txt|md)$/i.test(file.name) || file.size > 262_144) {
          throw new Error("Choose a .txt or .md file up to 256 KiB");
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer()
        );
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
    return (
      <div className="sm-stack">
        <div className="sm-row">
          <form
            className="sm-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setActiveQuery(query.trim());
              setRevision((value) => value + 1);
            }}
          >
            <Input
              aria-label={memory ? "Search memories" : "Search knowledge"}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={memory ? "Search memories" : "Search knowledge"}
              value={query}
            />
            <Button disabled={busy} type="submit" variant="outline">
              Search
            </Button>
          </form>
          <Button disabled={busy} onClick={() => setEditing(true)}>
            {memory ? "Remember" : "Add text"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
            variant="ghost"
          >
            Refresh
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        {editing && (
          <form className="sm-card sm-stack" onSubmit={save}>
            {!memory && (
              <>
                <label>
                  Title
                  <Input
                    disabled={busy}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label>
                  Text file
                  <Input
                    accept=".txt,.md,text/plain,text/markdown"
                    disabled={busy}
                    onChange={(event) => {
                      void readFile(event.target.files?.[0]);
                    }}
                    type="file"
                  />
                </label>
              </>
            )}
            <label>
              {memory ? "Fact to remember" : "Content"}
              <Textarea
                disabled={busy}
                maxLength={memory ? 10_000 : 262_144}
                onChange={(event) => setContent(event.target.value)}
                required
                rows={6}
                value={content}
              />
            </label>
            <label>
              Source (optional)
              <Input
                disabled={busy}
                maxLength={2048}
                onChange={(event) => setSource(event.target.value)}
                value={source}
              />
            </label>
            <div className="sm-row">
              <Button disabled={busy || readingFile} type="submit">
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setEditing(false)}
                type="button"
                variant="ghost"
              >
                Close
              </Button>
            </div>
          </form>
        )}
        {loading ? (
          <p role="status">Loading…</p>
        ) : items.length === 0 ? (
          <p>
            {activeQuery
              ? "No matching results"
              : memory
                ? "No memories yet"
                : "No documents yet"}
          </p>
        ) : (
          <ul className="sm-list">
            {items.map((item) => (
              <li className="sm-card" key={item.id}>
                <div className="sm-row">
                  <strong className="sm-title">{item.title}</strong>
                  <span>
                    {item.state === "deleting" ? "Removal pending" : item.state}
                  </span>
                </div>
                {item.excerpt && <p className="sm-excerpt">{item.excerpt}</p>}
                {item.source && <p className="sm-source">{item.source}</p>}
                <div className="sm-row">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void act(item, true);
                    }}
                    variant="ghost"
                  >
                    {item.state === "deleting"
                      ? "Retry removal"
                      : memory
                        ? "Forget"
                        : "Delete"}
                  </Button>
                  {["unknown", "pending", "submitting"].includes(
                    item.state
                  ) && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void act(item, false);
                      }}
                      variant="outline"
                    >
                      Check status
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!activeQuery && (
          <div className="sm-row">
            <Button
              disabled={page === 1 || busy}
              onClick={() => setPage((value) => value - 1)}
              variant="ghost"
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              disabled={!hasMore || busy}
              onClick={() => setPage((value) => value + 1)}
              variant="ghost"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    );
  }
  function Page() {
    const [profiles, setProfiles] = React.useState<Profile[]>([]);
    const [agentId, setAgentId] = React.useState("");
    const [kind, setKind] = React.useState<"memory" | "knowledge">("memory");
    const [canConfigure, setCanConfigure] = React.useState(false);
    const [configured, setConfigured] = React.useState(false);
    const [settings, setSettings] = React.useState(false);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => {
      let alive = true;
      ctx.host
        .call("profiles")
        .then((value) => {
          if (!alive || ctx.signal.aborted) {
            return;
          }
          const result = value as {
            profiles: Profile[];
            configured: boolean;
            canConfigure: boolean;
          };
          setProfiles(result.profiles);
          setAgentId(result.profiles[0]?.id ?? "");
          setConfigured(result.configured);
          setCanConfigure(result.canConfigure);
        })
        .catch((reason) => {
          if (alive) {
            setError(errorText(reason));
          }
        })
        .finally(() => {
          if (alive) {
            setLoading(false);
          }
        });
      return () => {
        alive = false;
      };
    }, []);
    return (
      <section className="sm-page sm-stack">
        <header className="sm-row">
          <h1 className="sm-title">Supermemory</h1>
          {configured && <span>Configured</span>}
          {canConfigure && (
            <Button onClick={() => setSettings(true)} variant="outline">
              Settings
            </Button>
          )}
        </header>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading…</p>
        ) : configured ? (
          <>
            <Select
              onValueChange={(value) => setAgentId(value ?? "")}
              value={agentId}
            >
              <SelectTrigger aria-label="Agent">
                <SelectValue placeholder="Choose agent" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div aria-label="Collection" className="sm-row" role="group">
              <Button
                aria-pressed={kind === "memory"}
                onClick={() => setKind("memory")}
                variant={kind === "memory" ? "default" : "ghost"}
              >
                Memory
              </Button>
              <Button
                aria-pressed={kind === "knowledge"}
                onClick={() => setKind("knowledge")}
                variant={kind === "knowledge" ? "default" : "ghost"}
              >
                Knowledge
              </Button>
            </div>
            {agentId ? (
              <Collection
                agentId={agentId}
                key={`${agentId}:${kind}`}
                kind={kind}
              />
            ) : (
              <p>No agents available</p>
            )}
          </>
        ) : (
          <p>
            {canConfigure
              ? "Connect your Supermemory server in Settings."
              : "Ask an admin to connect Supermemory."}
          </p>
        )}
        {settings && (
          <Settings
            close={() => setSettings(false)}
            saved={() => {
              setConfigured(true);
              setSettings(false);
            }}
          />
        )}
      </section>
    );
  }
  ctx.styles(
    ".sm-page{max-width:960px;margin:0 auto;padding:24px;width:100%;box-sizing:border-box}.sm-stack{display:flex;flex-direction:column;gap:16px}.sm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sm-title{flex:1;min-width:0;overflow-wrap:anywhere}.sm-page h1{font-size:24px;font-weight:600}.sm-search{display:flex;gap:8px;flex:1;min-width:180px}.sm-card{border:1px solid var(--border);border-radius:10px;padding:16px}.sm-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}.sm-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.sm-source{font-size:13px;overflow-wrap:anywhere;opacity:.7}.sm-stack label{display:grid;gap:6px}@media(max-width:600px){.sm-page{padding:16px}.sm-search{flex-basis:100%}}"
  );
  ctx.slots.register("page", Page);
}
