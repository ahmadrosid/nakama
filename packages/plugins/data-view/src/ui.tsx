/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import css from "../ui/style.css" with { type: "text" };
import type { JsonValue } from "./actions";

type Summary = {
  id: string;
  title: string;
  url: string;
  rows: number;
  pendingEdits: number;
  fetchedAt: number;
  syncedAt: number | null;
};

type Sheet = Summary & { data: string[][]; changed: string[] };

type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: JsonValue): Promise<JsonValue> };
};

type Cell = { row: number; column: number };

export const inject = ["slots", "host", "styles", "ui"];

const ROW_HEIGHT = 24;

const OVERSCAN = 20;

function columnLetter(column: number): string {
  let letters = "";

  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }

  return letters;
}

const errorText = (error: Error | string) =>
  error instanceof Error ? error.message : error;

function readSummary(value: JsonValue): Summary {
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Invalid Data View response");
  }

  return {
    fetchedAt: Number(value.fetchedAt),
    id: String(value.id),
    pendingEdits: Number(value.pendingEdits),
    rows: Number(value.rows),
    syncedAt: value.syncedAt === null ? null : Number(value.syncedAt),
    title: String(value.title),
    url: String(value.url),
  };
}

function readStrings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function readSheet(value: JsonValue): Sheet {
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Invalid Data View response");
  }

  return {
    ...readSummary(value),
    changed: readStrings(value.changed),
    data: Array.isArray(value.data) ? value.data.map(readStrings) : [],
  };
}

export function apply(ctx: Context) {
  const React = ctx.React;
  const { Button, ConfirmDialog, Input, Spinner } = ctx.ui;

  ctx.styles(css);

  function SheetGrid({
    sheet,
    onEdit,
  }: {
    sheet: Sheet;
    onEdit: (cell: Cell, value: string) => void;
  }) {
    const [selected, setSelected] = React.useState<Cell>({
      column: 0,
      row: 0,
    });

    const [editing, setEditing] = React.useState<string | null>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [height, setHeight] = React.useState(600);
    const scroller = React.useRef<HTMLDivElement>(null);
    const closing = React.useRef(false);
    const changed = React.useMemo(() => new Set(sheet.changed), [sheet]);
    const rows = sheet.data.length;
    const columns = sheet.data[0]?.length ?? 1;
    const value = sheet.data[selected.row]?.[selected.column] ?? "";

    React.useEffect(() => {
      const element = scroller.current;

      if (!element) {
        return;
      }

      const observer = new ResizeObserver(() =>
        setHeight(element.clientHeight)
      );

      observer.observe(element);

      return () => observer.disconnect();
    }, []);

    const move = (row: number, column: number) => {
      const next = {
        column: Math.min(Math.max(column, 0), columns - 1),
        row: Math.min(Math.max(row, 0), rows - 1),
      };

      setSelected(next);
      setEditing(null);

      const element = scroller.current;

      if (element) {
        // Row 1 stays frozen under the letters, so data rows scroll below it.
        const top = next.row * ROW_HEIGHT;

        if (top < element.scrollTop + ROW_HEIGHT && next.row > 0) {
          element.scrollTop = top - ROW_HEIGHT;
        } else if (
          top + ROW_HEIGHT * 2 >
          element.scrollTop + element.clientHeight
        ) {
          element.scrollTop = top + ROW_HEIGHT * 2 - element.clientHeight;
        }
      }
    };

    const commit = (next: string) => {
      if (next !== value) {
        onEdit(selected, next);
      }

      setEditing(null);
    };

    const onKeyDown = (event: ReactType.KeyboardEvent<HTMLDivElement>) => {
      if (editing !== null) {
        return;
      }

      const { column, row } = selected;

      const target = new Map<string, [number, number]>([
        ["ArrowDown", [row + 1, column]],
        ["ArrowLeft", [row, column - 1]],
        ["ArrowRight", [row, column + 1]],
        ["ArrowUp", [row - 1, column]],
        ["Tab", [row, column + (event.shiftKey ? -1 : 1)]],
      ]).get(event.key);

      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        setEditing(value);
      } else if (target) {
        event.preventDefault();
        move(...target);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        commit("");
      } else if (
        event.key.length === 1 &&
        !(event.metaKey || event.ctrlKey || event.altKey)
      ) {
        event.preventDefault();
        setEditing(event.key);
      }
    };

    const onEditorKeyDown = (
      event: ReactType.KeyboardEvent<HTMLInputElement>
    ) => {
      event.stopPropagation();

      if (event.key === "Escape") {
        closing.current = true;
        setEditing(null);
        scroller.current?.focus();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        closing.current = true;
        commit(event.currentTarget.value);
        const down = event.key === "Enter";
        move(
          selected.row + (down ? (event.shiftKey ? -1 : 1) : 0),
          selected.column + (down ? 0 : event.shiftKey ? -1 : 1)
        );
        scroller.current?.focus();
      }
    };

    // Row 1 renders frozen, so the window covers data rows only.
    const first = Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);

    const last = Math.min(
      rows,
      Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
    );

    const renderRow = (row: number) => (
      <tr data-frozen={row === 0 || undefined} key={row}>
        <th
          aria-selected={row === selected.row}
          className="dv-row-head"
          scope="row"
        >
          {row + 1}
        </th>
        {Array.from({ length: columns }, (_, column) => {
          const isSelected = row === selected.row && column === selected.column;

          return (
            <td
              aria-selected={isSelected}
              data-changed={changed.has(`${row}:${column}`) || undefined}
              key={column}
              onClick={() => move(row, column)}
              onDoubleClick={() => {
                move(row, column);
                setEditing(sheet.data[row]?.[column] ?? "");
              }}
            >
              {isSelected && editing !== null ? (
                <input
                  aria-label={`${columnLetter(column)}${row + 1}`}
                  autoFocus
                  className="dv-editor"
                  defaultValue={editing}
                  onBlur={(event) => {
                    // Escape cancels; Enter and Tab already saved.
                    if (closing.current) {
                      closing.current = false;
                    } else {
                      commit(event.currentTarget.value);
                    }
                  }}
                  onFocus={() => {
                    closing.current = false;
                  }}
                  onKeyDown={onEditorKeyDown}
                />
              ) : (
                sheet.data[row]?.[column]
              )}
            </td>
          );
        })}
      </tr>
    );

    return (
      <>
        <div className="dv-formula">
          <span className="dv-ref">
            {columnLetter(selected.column)}
            {selected.row + 1}
          </span>
          <span aria-hidden="true" className="dv-fx">
            fx
          </span>
          <input
            aria-label="Cell value"
            defaultValue={value}
            key={`${selected.row}:${selected.column}:${value}`}
            onBlur={(event) => {
              if (event.currentTarget.value !== value) {
                onEdit(selected, event.currentTarget.value);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
                scroller.current?.focus();
              }
            }}
          />
        </div>
        <div
          aria-label={sheet.title}
          className="dv-grid"
          onKeyDown={onKeyDown}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          ref={scroller}
          role="grid"
          tabIndex={0}
        >
          <table>
            <colgroup>
              <col className="dv-row-col" />
              {Array.from({ length: columns }, (_, column) => (
                <col key={column} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="dv-corner" />
                {Array.from({ length: columns }, (_, column) => (
                  <th
                    aria-selected={column === selected.column}
                    key={column}
                    scope="col"
                  >
                    {columnLetter(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderRow(0)}
              {first > 1 ? (
                <tr style={{ height: (first - 1) * ROW_HEIGHT }} />
              ) : null}
              {Array.from({ length: Math.max(0, last - first) }, (_, index) =>
                renderRow(first + index)
              )}
              {last < rows ? (
                <tr style={{ height: (rows - last) * ROW_HEIGHT }} />
              ) : null}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function DataViewPage() {
    const [sheets, setSheets] = React.useState<Summary[]>([]);
    const [sheet, setSheet] = React.useState<Sheet | null>(null);
    const [url, setUrl] = React.useState("");
    const [busy, setBusy] = React.useState("");
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");

    const [confirming, setConfirming] = React.useState<
      "refresh" | "remove" | null
    >(null);

    const queue = React.useRef(Promise.resolve());

    const run = async (label: string, work: () => Promise<void>) => {
      setBusy(label);
      setError("");
      setNotice("");

      try {
        await work();
      } catch (reason) {
        setError(errorText(reason instanceof Error ? reason : String(reason)));
      } finally {
        setBusy("");
      }
    };

    const loadList = async () => {
      const value = await ctx.host.call("list_sheets");
      setSheets(Array.isArray(value) ? value.map(readSummary) : []);
    };

    const open = async (sheetId: string) => {
      setSheet(readSheet(await ctx.host.call("get_sheet", { sheetId })));
    };

    const updateSummary = (summary: Summary) =>
      setSheets((current) =>
        current.map((entry) => (entry.id === summary.id ? summary : entry))
      );

    React.useEffect(() => {
      run("load", async () => {
        const value = await ctx.host.call("list_sheets");
        const list = Array.isArray(value) ? value.map(readSummary) : [];
        setSheets(list);

        if (list[0]) {
          await open(list[0].id);
        }
      });
    }, []);

    const add = (event: ReactType.FormEvent) => {
      event.preventDefault();
      run("add", async () => {
        const added = readSummary(
          await ctx.host.call("add_sheet", { url: url.trim() })
        );

        setUrl("");
        await loadList();
        await open(added.id);
      });
    };

    const edit = (cell: Cell, value: string) => {
      if (!sheet) {
        return;
      }

      const sheetId = sheet.id;
      const header = sheet.data[0] ?? [];
      const name = header[cell.column] ?? "";

      const column =
        name && header.indexOf(name) === header.lastIndexOf(name)
          ? name
          : columnLetter(cell.column);

      setSheet(
        (current) =>
          current && {
            ...current,
            data: current.data.map((row, index) =>
              index === cell.row
                ? row.map((entry, at) => (at === cell.column ? value : entry))
                : row
            ),
          }
      );

      // Edits save in order, so a later value never lands before an earlier one.
      queue.current = queue.current.then(async () => {
        try {
          const result = await ctx.host.call("update_cells", {
            edits: [{ column, row: cell.row + 1, value }],
            sheetId,
          });

          const summary = readSummary(result);
          updateSummary(summary);
          setSheet((current) =>
            current?.id === sheetId
              ? {
                  ...current,
                  ...summary,
                  changed:
                    result instanceof Object && !Array.isArray(result)
                      ? readStrings(result.changed)
                      : current.changed,
                }
              : current
          );
        } catch (reason) {
          setError(
            errorText(reason instanceof Error ? reason : String(reason))
          );
          await open(sheetId);
        }
      });
    };

    const addRow = () => {
      if (sheet) {
        const sheetId = sheet.id;
        run("row", async () => {
          await queue.current;
          await ctx.host.call("update_cells", {
            edits: [{ column: "A", row: sheet.data.length + 1, value: "" }],
            sheetId,
          });
          await open(sheetId);
        });
      }
    };

    const refresh = async (discardEdits: boolean) => {
      if (!sheet) {
        return;
      }

      await queue.current;
      updateSummary(
        readSummary(
          await ctx.host.call("refresh_sheet", {
            discardEdits,
            sheetId: sheet.id,
          })
        )
      );
      await open(sheet.id);
    };

    const sync = () => {
      if (sheet) {
        run("sync", async () => {
          await queue.current;

          const result = await ctx.host.call("sync_sheet", {
            sheetId: sheet.id,
          });

          updateSummary(readSummary(result));
          await open(sheet.id);

          const written =
            result instanceof Object && !Array.isArray(result)
              ? Number(result.written)
              : 0;

          setNotice(`Synced ${written} cells to Google Sheets.`);
        });
      }
    };

    const remove = async () => {
      if (sheet) {
        await ctx.host.call("delete_sheet", { sheetId: sheet.id });
        setSheet(null);
        await loadList();
      }
    };

    return (
      <div className="dv-page">
        <aside className="dv-sidebar">
          <form className="dv-add" onSubmit={add}>
            <Input
              aria-label="Google Sheets link"
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder="Paste a Google Sheets link"
              value={url}
            />
            <Button disabled={!url.trim() || Boolean(busy)} type="submit">
              {busy === "add" ? <Spinner /> : "Add"}
            </Button>
          </form>
          <ul>
            {sheets.map((entry) => (
              <li key={entry.id}>
                <button
                  aria-current={entry.id === sheet?.id || undefined}
                  onClick={() => run("open", () => open(entry.id))}
                  type="button"
                >
                  <span>{entry.title}</span>
                  {entry.pendingEdits ? (
                    <span className="dv-badge">{entry.pendingEdits}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="dv-main">
          {error ? (
            <p className="dv-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="dv-notice" role="status">
              {notice}
            </p>
          ) : null}
          {sheet ? (
            <>
              <header className="dv-toolbar">
                <a href={sheet.url} rel="noreferrer" target="_blank">
                  {sheet.title}
                </a>
                <span className="dv-status">
                  {sheet.pendingEdits
                    ? `${sheet.pendingEdits} unsynced edits`
                    : "All changes synced"}
                </span>
                <Button onClick={addRow} size="sm" variant="ghost">
                  Add row
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    sheet.pendingEdits
                      ? setConfirming("refresh")
                      : run("refresh", () => refresh(false))
                  }
                  size="sm"
                  variant="outline"
                >
                  {busy === "refresh" ? <Spinner /> : "Refresh"}
                </Button>
                <Button
                  disabled={Boolean(busy) || !sheet.pendingEdits}
                  onClick={sync}
                  size="sm"
                >
                  {busy === "sync" ? <Spinner /> : "Sync"}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => setConfirming("remove")}
                  size="sm"
                  variant="ghost"
                >
                  Remove
                </Button>
              </header>
              <SheetGrid onEdit={edit} sheet={sheet} />
              {confirming === "refresh" ? (
                <ConfirmDialog
                  confirmLabel="Discard and refresh"
                  description={`${sheet.pendingEdits} unsynced edits will be lost.`}
                  onClose={() => setConfirming(null)}
                  onConfirm={() => refresh(true)}
                  title="Discard unsynced edits?"
                />
              ) : null}
              {confirming === "remove" ? (
                <ConfirmDialog
                  confirmLabel="Remove"
                  description={`${sheet.title} leaves Data View. Google Sheets does not change.`}
                  onClose={() => setConfirming(null)}
                  onConfirm={remove}
                  title="Remove sheet?"
                />
              ) : null}
            </>
          ) : (
            <div className="dv-empty">
              {busy === "load" ? <Spinner /> : "Add a Google Sheets link."}
            </div>
          )}
        </main>
      </div>
    );
  }

  ctx.slots.register("page", DataViewPage);
}
