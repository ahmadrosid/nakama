/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type * as ReactType from "react";
import css from "../ui/style.css" with { type: "text" };
import type { JsonValue } from "./actions";
import {
  type Cell,
  type Context,
  columnLetter,
  createSheetGrid,
  type Sheet,
  type Summary,
} from "./ui-grid";

export const inject = ["slots", "host", "styles", "ui"];

// The sheet picker shows a search field once the list is longer than this.
const SEARCH_AFTER = 6;

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

  const {
    Button,
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Spinner,
  } = ctx.ui;

  const ICONS = {
    chevron: "M6 9l6 6 6-6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    sheet:
      "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9h16M4 15h16M10 9v12",
  };

  function Icon({ kind }: { kind: keyof typeof ICONS }) {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={kind === "more" ? 3 : 1.8}
        viewBox="0 0 24 24"
        width="16"
      >
        <path d={ICONS[kind]} />
      </svg>
    );
  }

  ctx.styles(css);

  const SheetGrid = createSheetGrid(ctx);

  function DataViewPage() {
    const [sheets, setSheets] = React.useState<Summary[]>([]);
    const [sheet, setSheet] = React.useState<Sheet | null>(null);
    const [url, setUrl] = React.useState("");
    const [pickerOpen, setPickerOpen] = React.useState(false);
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
        setPickerOpen(false);
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

    const addForm = (
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
    );

    return (
      <div className="dv-page">
        <header className="dv-toolbar">
          <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
            <PopoverTrigger
              render={<button className="dv-picker-trigger" type="button" />}
            >
              <Icon kind="sheet" />
              <span>{sheet?.title ?? "Add a sheet"}</span>
              <Icon kind="chevron" />
            </PopoverTrigger>
            <PopoverContent align="start" className="dv-picker">
              {sheets.length ? (
                <Command>
                  {sheets.length > SEARCH_AFTER ? (
                    <CommandInput
                      aria-label="Search sheets"
                      placeholder="Search sheets"
                    />
                  ) : null}
                  <CommandList>
                    <CommandEmpty>No sheets found</CommandEmpty>
                    {sheets.map((entry) => (
                      <CommandItem
                        data-current={entry.id === sheet?.id || undefined}
                        key={entry.id}
                        onSelect={() => {
                          setPickerOpen(false);
                          run("open", () => open(entry.id));
                        }}
                        value={`${entry.title} ${entry.id}`}
                      >
                        <span className="dv-picker-title">{entry.title}</span>
                        {entry.pendingEdits ? (
                          <span className="dv-badge">{entry.pendingEdits}</span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              ) : null}
              {addForm}
            </PopoverContent>
          </Popover>
          <span
            className="dv-status"
            data-pending={Boolean(sheet?.pendingEdits) || undefined}
          >
            {sheet
              ? sheet.pendingEdits
                ? `${sheet.pendingEdits} unsynced`
                : "Synced"
              : null}
          </span>
          {sheet ? (
            <>
              <Button
                aria-label="Refresh"
                disabled={Boolean(busy)}
                onClick={() =>
                  sheet.pendingEdits
                    ? setConfirming("refresh")
                    : run("refresh", () => refresh(false))
                }
                size="icon-sm"
                title="Refresh"
                variant="ghost"
              >
                {busy === "refresh" ? <Spinner /> : <Icon kind="refresh" />}
              </Button>
              <Button
                disabled={Boolean(busy) || !sheet.pendingEdits}
                onClick={sync}
                size="sm"
              >
                {busy === "sync" ? <Spinner /> : "Sync"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={Boolean(busy)}
                  render={
                    <Button
                      aria-label="More actions"
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Icon kind="more" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={addRow}>Add row</DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      window.open(sheet.url, "_blank", "noopener,noreferrer")
                    }
                  >
                    Open in Google Sheets
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setConfirming("remove")}
                    variant="destructive"
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </header>
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
            {busy === "load" ? <Spinner /> : addForm}
          </div>
        )}
      </div>
    );
  }

  ctx.slots.register("page", DataViewPage);
}
