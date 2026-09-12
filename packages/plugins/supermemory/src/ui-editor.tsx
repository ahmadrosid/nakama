/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { Context } from "./ui-context";
import type { CollectionModel } from "./use-collection";
export function createEditor(ctx: Context) {
  const React = ctx.React;
  const { Button, Input, Textarea } = ctx.ui;
  return function Editor({ model }: { model: CollectionModel }) {
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
      save,
    } = model;
    return (
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
    );
  };
}
