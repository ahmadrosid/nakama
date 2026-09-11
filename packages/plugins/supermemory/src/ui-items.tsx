/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { Context } from "./ui-context";
import type { CollectionModel } from "./use-collection";
export function createItems(ctx: Context) {
  const React = ctx.React;
  const { Button } = ctx.ui;
  return function Items({ model }: { model: CollectionModel }) {
    const { loading, items, activeQuery, memory, busy, act } = model;
    return loading ? (
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
              {["unknown", "pending", "submitting"].includes(item.state) && (
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
    );
  };
}
