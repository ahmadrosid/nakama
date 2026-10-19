/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import type { JsonValue } from "./actions";

export type Summary = {
  id: string;
  title: string;
  url: string;
  rows: number;
  pendingEdits: number;
  fetchedAt: number;
  syncedAt: number | null;
};

export type Sheet = Summary & { data: string[][]; changed: string[] };

export type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: JsonValue): Promise<JsonValue> };
};

export type Cell = { row: number; column: number };

const ROW_HEIGHT = 24;

const OVERSCAN = 20;

export function columnLetter(column: number): string {
  let letters = "";

  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }

  return letters;
}

/** The Sheets-style grid: formula bar, frozen header row, keyboard editing. */
export function createSheetGrid(ctx: Context) {
  const React = ctx.React;

  return function SheetGrid({
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
  };
}
