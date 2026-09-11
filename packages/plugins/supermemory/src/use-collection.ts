import type * as ReactType from "react";
import { type Context, errorText, type Item } from "./ui-context";
export function useCollection(
  ctx: Context,
  agentId: string,
  kind: "memory" | "knowledge"
) {
  const React = ctx.React;
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
  return {
    act,
    activeQuery,
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
    title,
  };
}
export type CollectionModel = ReturnType<typeof useCollection>;
