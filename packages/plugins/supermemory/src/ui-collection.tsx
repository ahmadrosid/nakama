/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ReactNode } from "react";
import type { Context } from "./ui-context";
import { createEditor } from "./ui-editor";
import { createItems } from "./ui-items";
import { useCollection } from "./use-collection";
export function createCollection(ctx: Context) {
  const React = ctx.React;
  const { Button, Input } = ctx.ui;
  const Editor = createEditor(ctx);
  const Items = createItems(ctx);
  function Collection({
    agentId,
    kind,
    toolbar,
    tabs,
  }: {
    toolbar: ReactNode;
    tabs: ReactNode;
    agentId: string;
    kind: "memory" | "knowledge";
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
      editing,
      setEditing,
      setRevision,
    } = model;
    return (
      <div className="sm-stack">
        <div className="sm-row sm-toolbar">
          {toolbar}
          <Button disabled={busy} onClick={() => setEditing(true)}>
            {memory ? "Add memory" : "Add text"}
          </Button>
        </div>
        {tabs}
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
        </div>
        {error && <p role="alert">{error}</p>}
        {editing && <Editor model={model} />}
        <Items model={model} />
        {!activeQuery && (page > 1 || hasMore) && (
          <div className="sm-row sm-pagination">
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
  return Collection;
}
