/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { Context, Item } from "./ui-context";
import type { CollectionModel } from "./use-collection";
export function createItems(ctx: Context) {
  const React = ctx.React;
  const {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  } = ctx.ui;
  function ItemActions({
    item,
    model,
  }: {
    item: Item;
    model: CollectionModel;
  }) {
    const { busy, act, memory } = model;
    const [dialog, setDialog] = React.useState<"delete" | null>(null);
    const controls = (
      <>
        <Button
          className={
            memory ? undefined : "text-destructive hover:text-destructive"
          }
          disabled={busy}
          onClick={() => {
            setDialog("delete");
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
          >
            Check status
          </Button>
        )}
      </>
    );
    return (
      <div className="sm-row">
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
            }
          }}
          open={dialog === "delete"}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {memory ? "Forget memory?" : "Delete document?"}
              </DialogTitle>
              <DialogDescription>
                {item.title} will be removed from this agent’s{" "}
                {memory ? "memory" : "knowledge"}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setDialog(null)} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setDialog(null);
                  void act(item, true);
                }}
                variant="destructive"
              >
                {memory ? "Forget" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {!memory && (
          <Button
            render={
              <a
                aria-label={`View ${item.title}`}
                href={`/plugins/supermemory?agent=${encodeURIComponent(model.agentId)}&document=${encodeURIComponent(item.id)}`}
              />
            }
            variant="outline"
          >
            View
          </Button>
        )}
        {controls}
      </div>
    );
  }
  function DocumentTable({ model }: { model: CollectionModel }) {
    return (
      <div className="sm-table-wrap">
        <table aria-label="Knowledge documents" className="sm-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {model.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <a
                    className="sm-document-name"
                    href={`/plugins/supermemory?agent=${encodeURIComponent(model.agentId)}&document=${encodeURIComponent(item.id)}`}
                  >
                    {item.title}
                  </a>
                  {item.excerpt && <p className="sm-excerpt">{item.excerpt}</p>}
                </td>
                <td className="sm-source">{item.source || "—"}</td>
                <td>
                  <span className="sm-document-status" data-state={item.state}>
                    {item.state === "deleting" ? "Removal pending" : item.state}
                  </span>
                </td>
                <td>
                  <ItemActions item={item} model={model} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return function Items({ model }: { model: CollectionModel }) {
    const { loading, items, activeQuery, memory } = model;
    return loading ? (
      <p role="status">Loading…</p>
    ) : items.length === 0 ? (
      <p className="sm-empty">
        {activeQuery
          ? "No matching results"
          : memory
            ? "No memories yet"
            : "No documents yet"}
      </p>
    ) : memory ? (
      <ul className="sm-list">
        {items.map((item) => (
          <li className="sm-item" key={item.id}>
            <div className="sm-row">
              <strong className="sm-title">{item.title}</strong>
              <span>
                {item.state === "deleting" ? "Removal pending" : item.state}
              </span>
            </div>
            {item.excerpt && <p className="sm-excerpt">{item.excerpt}</p>}
            {item.source && <p className="sm-source">{item.source}</p>}
            <ItemActions item={item} model={model} />
          </li>
        ))}
      </ul>
    ) : (
      <DocumentTable model={model} />
    );
  };
}
