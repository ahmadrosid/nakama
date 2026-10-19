// ui/style.css
var style_default = `[data-plugin-id="data-view"] {
  --dv-grid-line: color-mix(in oklab, var(--foreground) 12%, transparent);
  --dv-head: color-mix(in oklab, var(--foreground) 4%, var(--background));
  --dv-head-active: color-mix(in oklab, #1a73e8 18%, var(--background));
  --dv-accent: #1a73e8;
  --dv-changed: color-mix(in oklab, #fbbc04 22%, var(--background));
  &:has(> .dv-page) {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  .dv-page {
    display: grid;
    flex: 1;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 0;
    font-size: 14px;
    color: var(--foreground);
  }

  .dv-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    padding: 12px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }

  .dv-add {
    display: flex;
    gap: 6px;
  }

  .dv-sidebar ul {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .dv-sidebar li button {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: none;
    border: 0;
    border-radius: 6px;
  }

  .dv-sidebar li button span:first-child {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dv-sidebar li button:hover,
  .dv-sidebar li button[aria-current] {
    background: var(--muted);
  }

  .dv-badge {
    min-width: 20px;
    padding: 0 6px;
    font-size: 12px;
    line-height: 18px;
    color: #202124;
    text-align: center;
    background: #fbbc04;
    border-radius: 9px;
  }

  .dv-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .dv-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .dv-toolbar a {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 16px;
    font-weight: 500;
    color: inherit;
    white-space: nowrap;
    text-decoration: none;
  }

  .dv-toolbar a:hover {
    text-decoration: underline;
  }

  .dv-status {
    flex: 1;
    font-size: 12px;
    color: var(--muted-foreground);
    white-space: nowrap;
  }

  .dv-error,
  .dv-notice {
    padding: 8px 12px;
    margin: 0;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
  }

  .dv-error {
    color: var(--destructive);
  }

  .dv-notice {
    color: var(--muted-foreground);
  }

  .dv-empty {
    display: grid;
    flex: 1;
    place-items: center;
    color: var(--muted-foreground);
  }

  .dv-formula {
    display: flex;
    align-items: center;
    height: 30px;
    font-family: Arial, sans-serif;
    font-size: 13px;
    border-bottom: 1px solid var(--dv-grid-line);
  }

  .dv-ref {
    width: 90px;
    padding: 0 8px;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid var(--dv-grid-line);
  }

  .dv-fx {
    padding: 0 10px;
    font-style: italic;
    color: var(--muted-foreground);
    border-right: 1px solid var(--dv-grid-line);
  }

  .dv-formula input {
    flex: 1;
    height: 100%;
    padding: 0 8px;
    font: inherit;
    color: inherit;
    outline: none;
    background: none;
    border: 0;
  }

  .dv-grid {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
  }

  .dv-grid table {
    font-family: Arial, sans-serif;
    font-size: 13px;
    table-layout: fixed;
    border-spacing: 0;
    border-collapse: separate;
  }

  .dv-grid col {
    width: 120px;
  }

  .dv-grid col.dv-row-col {
    width: 46px;
  }

  .dv-grid th,
  .dv-grid td {
    box-sizing: border-box;
    height: 24px;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--dv-grid-line);
    border-bottom: 1px solid var(--dv-grid-line);
  }

  .dv-grid th {
    font-weight: 400;
    color: var(--muted-foreground);
    text-align: center;
    background: var(--dv-head);
  }

  .dv-grid th[aria-selected="true"] {
    font-weight: 600;
    color: var(--foreground);
    background: var(--dv-head-active);
  }

  .dv-grid thead th {
    position: sticky;
    top: 0;
    z-index: 3;
  }

  .dv-grid .dv-row-head,
  .dv-grid .dv-corner {
    position: sticky;
    left: 0;
    z-index: 2;
  }

  .dv-grid .dv-corner {
    z-index: 4;
  }

  /* Row 1 stays frozen under the column letters, like a frozen header row. */
  .dv-grid tr[data-frozen] > * {
    position: sticky;
    top: 24px;
    z-index: 1;
    background: var(--background);
    border-bottom: 2px solid var(--dv-grid-line);
  }

  .dv-grid tr[data-frozen] > .dv-row-head {
    z-index: 3;
    background: var(--dv-head);
  }

  .dv-grid td {
    cursor: cell;
    background: var(--background);
  }

  .dv-grid td[data-changed] {
    background: var(--dv-changed);
  }

  .dv-grid td[aria-selected="true"] {
    outline: 2px solid var(--dv-accent);
    outline-offset: -2px;
  }

  .dv-editor {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 0;
    font: inherit;
    color: inherit;
    outline: none;
    background: var(--background);
    border: 0;
  }

  @media (max-width: 720px) {
    .dv-page {
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr);
    }

    .dv-sidebar {
      max-height: 180px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .dv-toolbar {
      flex-wrap: wrap;
    }
  }
}
`;

// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
var ROW_HEIGHT = 24;
var OVERSCAN = 20;
function columnLetter(column) {
  let letters = "";
  for (let rest = column + 1;rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + (rest - 1) % 26) + letters;
  }
  return letters;
}
var errorText = (error) => error instanceof Error ? error.message : error;
function readSummary(value) {
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
    url: String(value.url)
  };
}
function readStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
function readSheet(value) {
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Invalid Data View response");
  }
  return {
    ...readSummary(value),
    changed: readStrings(value.changed),
    data: Array.isArray(value.data) ? value.data.map(readStrings) : []
  };
}
function apply(ctx) {
  const React = ctx.React;
  const { Button, ConfirmDialog, Input, Spinner } = ctx.ui;
  ctx.styles(style_default);
  function SheetGrid({
    sheet,
    onEdit
  }) {
    const [selected, setSelected] = React.useState({
      column: 0,
      row: 0
    });
    const [editing, setEditing] = React.useState(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [height, setHeight] = React.useState(600);
    const scroller = React.useRef(null);
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
      const observer = new ResizeObserver(() => setHeight(element.clientHeight));
      observer.observe(element);
      return () => observer.disconnect();
    }, []);
    const move = (row, column) => {
      const next = {
        column: Math.min(Math.max(column, 0), columns - 1),
        row: Math.min(Math.max(row, 0), rows - 1)
      };
      setSelected(next);
      setEditing(null);
      const element = scroller.current;
      if (element) {
        const top = next.row * ROW_HEIGHT;
        if (top < element.scrollTop + ROW_HEIGHT && next.row > 0) {
          element.scrollTop = top - ROW_HEIGHT;
        } else if (top + ROW_HEIGHT * 2 > element.scrollTop + element.clientHeight) {
          element.scrollTop = top + ROW_HEIGHT * 2 - element.clientHeight;
        }
      }
    };
    const commit = (next) => {
      if (next !== value) {
        onEdit(selected, next);
      }
      setEditing(null);
    };
    const onKeyDown = (event) => {
      if (editing !== null) {
        return;
      }
      const { column, row } = selected;
      const target = new Map([
        ["ArrowDown", [row + 1, column]],
        ["ArrowLeft", [row, column - 1]],
        ["ArrowRight", [row, column + 1]],
        ["ArrowUp", [row - 1, column]],
        ["Tab", [row, column + (event.shiftKey ? -1 : 1)]]
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
      } else if (event.key.length === 1 && !(event.metaKey || event.ctrlKey || event.altKey)) {
        event.preventDefault();
        setEditing(event.key);
      }
    };
    const onEditorKeyDown = (event) => {
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
        move(selected.row + (down ? event.shiftKey ? -1 : 1 : 0), selected.column + (down ? 0 : event.shiftKey ? -1 : 1));
        scroller.current?.focus();
      }
    };
    const first = Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    const renderRow = (row) => /* @__PURE__ */ React.createElement("tr", {
      "data-frozen": row === 0 || undefined,
      key: row
    }, /* @__PURE__ */ React.createElement("th", {
      "aria-selected": row === selected.row,
      className: "dv-row-head",
      scope: "row"
    }, row + 1), Array.from({ length: columns }, (_, column) => {
      const isSelected = row === selected.row && column === selected.column;
      return /* @__PURE__ */ React.createElement("td", {
        "aria-selected": isSelected,
        "data-changed": changed.has(`${row}:${column}`) || undefined,
        key: column,
        onClick: () => move(row, column),
        onDoubleClick: () => {
          move(row, column);
          setEditing(sheet.data[row]?.[column] ?? "");
        }
      }, isSelected && editing !== null ? /* @__PURE__ */ React.createElement("input", {
        "aria-label": `${columnLetter(column)}${row + 1}`,
        autoFocus: true,
        className: "dv-editor",
        defaultValue: editing,
        onBlur: (event) => {
          if (closing.current) {
            closing.current = false;
          } else {
            commit(event.currentTarget.value);
          }
        },
        onFocus: () => {
          closing.current = false;
        },
        onKeyDown: onEditorKeyDown
      }) : sheet.data[row]?.[column]);
    }));
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
      className: "dv-formula"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "dv-ref"
    }, columnLetter(selected.column), selected.row + 1), /* @__PURE__ */ React.createElement("span", {
      "aria-hidden": "true",
      className: "dv-fx"
    }, "fx"), /* @__PURE__ */ React.createElement("input", {
      "aria-label": "Cell value",
      defaultValue: value,
      key: `${selected.row}:${selected.column}:${value}`,
      onBlur: (event) => {
        if (event.currentTarget.value !== value) {
          onEdit(selected, event.currentTarget.value);
        }
      },
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
          scroller.current?.focus();
        }
      }
    })), /* @__PURE__ */ React.createElement("div", {
      "aria-label": sheet.title,
      className: "dv-grid",
      onKeyDown,
      onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
      ref: scroller,
      role: "grid",
      tabIndex: 0
    }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("colgroup", null, /* @__PURE__ */ React.createElement("col", {
      className: "dv-row-col"
    }), Array.from({ length: columns }, (_, column) => /* @__PURE__ */ React.createElement("col", {
      key: column
    }))), /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", {
      className: "dv-corner"
    }), Array.from({ length: columns }, (_, column) => /* @__PURE__ */ React.createElement("th", {
      "aria-selected": column === selected.column,
      key: column,
      scope: "col"
    }, columnLetter(column))))), /* @__PURE__ */ React.createElement("tbody", null, renderRow(0), first > 1 ? /* @__PURE__ */ React.createElement("tr", {
      style: { height: (first - 1) * ROW_HEIGHT }
    }) : null, Array.from({ length: Math.max(0, last - first) }, (_, index) => renderRow(first + index)), last < rows ? /* @__PURE__ */ React.createElement("tr", {
      style: { height: (rows - last) * ROW_HEIGHT }
    }) : null))));
  }
  function DataViewPage() {
    const [sheets, setSheets] = React.useState([]);
    const [sheet, setSheet] = React.useState(null);
    const [url, setUrl] = React.useState("");
    const [busy, setBusy] = React.useState("");
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const [confirming, setConfirming] = React.useState(null);
    const queue = React.useRef(Promise.resolve());
    const run = async (label, work) => {
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
    const open = async (sheetId) => {
      setSheet(readSheet(await ctx.host.call("get_sheet", { sheetId })));
    };
    const updateSummary = (summary) => setSheets((current) => current.map((entry) => entry.id === summary.id ? summary : entry));
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
    const add = (event) => {
      event.preventDefault();
      run("add", async () => {
        const added = readSummary(await ctx.host.call("add_sheet", { url: url.trim() }));
        setUrl("");
        await loadList();
        await open(added.id);
      });
    };
    const edit = (cell, value) => {
      if (!sheet) {
        return;
      }
      const sheetId = sheet.id;
      const header = sheet.data[0] ?? [];
      const name = header[cell.column] ?? "";
      const column = name && header.indexOf(name) === header.lastIndexOf(name) ? name : columnLetter(cell.column);
      setSheet((current) => current && {
        ...current,
        data: current.data.map((row, index) => index === cell.row ? row.map((entry, at) => at === cell.column ? value : entry) : row)
      });
      queue.current = queue.current.then(async () => {
        try {
          const result = await ctx.host.call("update_cells", {
            edits: [{ column, row: cell.row + 1, value }],
            sheetId
          });
          const summary = readSummary(result);
          updateSummary(summary);
          setSheet((current) => current?.id === sheetId ? {
            ...current,
            ...summary,
            changed: result instanceof Object && !Array.isArray(result) ? readStrings(result.changed) : current.changed
          } : current);
        } catch (reason) {
          setError(errorText(reason instanceof Error ? reason : String(reason)));
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
            sheetId
          });
          await open(sheetId);
        });
      }
    };
    const refresh = async (discardEdits) => {
      if (!sheet) {
        return;
      }
      await queue.current;
      updateSummary(readSummary(await ctx.host.call("refresh_sheet", {
        discardEdits,
        sheetId: sheet.id
      })));
      await open(sheet.id);
    };
    const sync = () => {
      if (sheet) {
        run("sync", async () => {
          await queue.current;
          const result = await ctx.host.call("sync_sheet", {
            sheetId: sheet.id
          });
          updateSummary(readSummary(result));
          await open(sheet.id);
          const written = result instanceof Object && !Array.isArray(result) ? Number(result.written) : 0;
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
    return /* @__PURE__ */ React.createElement("div", {
      className: "dv-page"
    }, /* @__PURE__ */ React.createElement("aside", {
      className: "dv-sidebar"
    }, /* @__PURE__ */ React.createElement("form", {
      className: "dv-add",
      onSubmit: add
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Google Sheets link",
      onChange: (event) => setUrl(event.currentTarget.value),
      placeholder: "Paste a Google Sheets link",
      value: url
    }), /* @__PURE__ */ React.createElement(Button, {
      disabled: !url.trim() || Boolean(busy),
      type: "submit"
    }, busy === "add" ? /* @__PURE__ */ React.createElement(Spinner, null) : "Add")), /* @__PURE__ */ React.createElement("ul", null, sheets.map((entry) => /* @__PURE__ */ React.createElement("li", {
      key: entry.id
    }, /* @__PURE__ */ React.createElement("button", {
      "aria-current": entry.id === sheet?.id || undefined,
      onClick: () => run("open", () => open(entry.id)),
      type: "button"
    }, /* @__PURE__ */ React.createElement("span", null, entry.title), entry.pendingEdits ? /* @__PURE__ */ React.createElement("span", {
      className: "dv-badge"
    }, entry.pendingEdits) : null))))), /* @__PURE__ */ React.createElement("main", {
      className: "dv-main"
    }, error ? /* @__PURE__ */ React.createElement("p", {
      className: "dv-error",
      role: "alert"
    }, error) : null, notice ? /* @__PURE__ */ React.createElement("p", {
      className: "dv-notice",
      role: "status"
    }, notice) : null, sheet ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("header", {
      className: "dv-toolbar"
    }, /* @__PURE__ */ React.createElement("a", {
      href: sheet.url,
      rel: "noreferrer",
      target: "_blank"
    }, sheet.title), /* @__PURE__ */ React.createElement("span", {
      className: "dv-status"
    }, sheet.pendingEdits ? `${sheet.pendingEdits} unsynced edits` : "All changes synced"), /* @__PURE__ */ React.createElement(Button, {
      onClick: addRow,
      size: "sm",
      variant: "ghost"
    }, "Add row"), /* @__PURE__ */ React.createElement(Button, {
      disabled: Boolean(busy),
      onClick: () => sheet.pendingEdits ? setConfirming("refresh") : run("refresh", () => refresh(false)),
      size: "sm",
      variant: "outline"
    }, busy === "refresh" ? /* @__PURE__ */ React.createElement(Spinner, null) : "Refresh"), /* @__PURE__ */ React.createElement(Button, {
      disabled: Boolean(busy) || !sheet.pendingEdits,
      onClick: sync,
      size: "sm"
    }, busy === "sync" ? /* @__PURE__ */ React.createElement(Spinner, null) : "Sync"), /* @__PURE__ */ React.createElement(Button, {
      disabled: Boolean(busy),
      onClick: () => setConfirming("remove"),
      size: "sm",
      variant: "ghost"
    }, "Remove")), /* @__PURE__ */ React.createElement(SheetGrid, {
      onEdit: edit,
      sheet
    }), confirming === "refresh" ? /* @__PURE__ */ React.createElement(ConfirmDialog, {
      confirmLabel: "Discard and refresh",
      description: `${sheet.pendingEdits} unsynced edits will be lost.`,
      onClose: () => setConfirming(null),
      onConfirm: () => refresh(true),
      title: "Discard unsynced edits?"
    }) : null, confirming === "remove" ? /* @__PURE__ */ React.createElement(ConfirmDialog, {
      confirmLabel: "Remove",
      description: `${sheet.title} leaves Data View. Google Sheets does not change.`,
      onClose: () => setConfirming(null),
      onConfirm: remove,
      title: "Remove sheet?"
    }) : null) : /* @__PURE__ */ React.createElement("div", {
      className: "dv-empty"
    }, busy === "load" ? /* @__PURE__ */ React.createElement(Spinner, null) : "Add a Google Sheets link.")));
  }
  ctx.slots.register("page", DataViewPage);
}
export {
  apply,
  inject
};
