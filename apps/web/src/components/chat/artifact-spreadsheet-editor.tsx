import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { Add01Icon } from "hugeicons-react";
import { useEffect, useState } from "react";
import {
  columnIndexToLetter,
  normalizeSpreadsheetShape,
  parseSpreadsheetText,
  type SpreadsheetRows,
  serializeSpreadsheetText,
} from "@/lib/artifact-spreadsheet";
import { isSpreadsheetNumericCell } from "./spreadsheet-numeric";

const GRID_LINE = "border-border";
const GUTTER_BG = "bg-muted";
const GUTTER_TEXT = "text-muted-foreground";
const GUTTER_ACTIVE = "bg-accent text-foreground";
const SELECTION_RING = "z-[1] ring-2 ring-inset ring-ring";

type CellCoord = { row: number; col: number };

export function SpreadsheetGrid({
  rows,
  editable,
  onChangeCell,
  className,
  columnHeaders,
}: {
  rows: SpreadsheetRows;
  editable: boolean;
  onChangeCell?: (rowIndex: number, columnIndex: number, value: string) => void;
  className?: string;
  columnHeaders?: string[];
}) {
  const [selected, setSelected] = useState<CellCoord | null>(null);
  const namedHeaders = columnHeaders != null;
  const columnCount = Math.max(
    1,
    columnHeaders?.length ?? 0,
    ...rows.map((row) => row.length)
  );

  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto bg-background", className)}
    >
      <table className="w-max min-w-full border-collapse text-[13px] leading-none [font-family:Arial,Helvetica,sans-serif]">
        <thead>
          <tr>
            <th
              aria-hidden
              className={cn(
                "sticky top-0 left-0 z-30 h-6 w-10 min-w-10 border-r border-b p-0",
                GRID_LINE,
                GUTTER_BG
              )}
            />
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <th
                className={cn(
                  "sticky top-0 z-20 min-w-[6.5rem] border-r border-b px-1 text-[11px]",
                  GUTTER_TEXT,
                  namedHeaders
                    ? "h-7 px-1.5 text-left font-semibold"
                    : "h-6 text-center font-normal",
                  GRID_LINE,
                  GUTTER_BG,
                  selected?.col === columnIndex && GUTTER_ACTIVE
                )}
                key={`col-${columnIndex}`}
                scope="col"
              >
                {namedHeaders
                  ? (columnHeaders[columnIndex] ??
                    columnIndexToLetter(columnIndex))
                  : columnIndexToLetter(columnIndex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const isHeaderRow = !namedHeaders && rowIndex === 0;
            const rowNumber = rowIndex + 1;
            const rowSelected = selected?.row === rowIndex;

            return (
              <tr key={`row-${rowIndex}`}>
                <th
                  className={cn(
                    "sticky left-0 z-20 h-7 w-10 min-w-10 border-r border-b p-0 text-center font-normal text-[11px] tabular-nums",
                    GUTTER_TEXT,
                    GRID_LINE,
                    GUTTER_BG,
                    rowSelected && GUTTER_ACTIVE
                  )}
                  scope="row"
                >
                  {rowNumber}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const cell = row[columnIndex] ?? "";
                  const header = (
                    namedHeaders
                      ? columnHeaders[columnIndex]
                      : rows[0]?.[columnIndex]
                  )?.trim();
                  const columnLabel =
                    header && header.length > 0
                      ? header
                      : `Column ${columnIndexToLetter(columnIndex)}`;
                  const cellLabel = isHeaderRow
                    ? `Header ${columnLabel}`
                    : `${columnLabel}, row ${rowNumber}`;
                  const isSelected =
                    selected?.row === rowIndex && selected.col === columnIndex;
                  const numeric =
                    !isHeaderRow && isSpreadsheetNumericCell(cell);
                  const alignClass = isHeaderRow
                    ? "justify-center text-center font-semibold"
                    : numeric
                      ? "justify-end text-right tabular-nums"
                      : "justify-start text-left";

                  return (
                    <td
                      className={cn(
                        "relative h-7 min-w-[6.5rem] border-r border-b p-0 align-middle",
                        GRID_LINE,
                        isHeaderRow && GUTTER_BG,
                        isSelected && SELECTION_RING
                      )}
                      key={`cell-${rowIndex}-${columnIndex}`}
                    >
                      {editable ? (
                        <input
                          aria-label={cellLabel}
                          className={cn(
                            "h-7 w-full min-w-[6.5rem] bg-transparent px-1.5 text-foreground outline-none",
                            alignClass
                          )}
                          onChange={(event) =>
                            onChangeCell?.(
                              rowIndex,
                              columnIndex,
                              event.target.value
                            )
                          }
                          onFocus={() =>
                            setSelected({ col: columnIndex, row: rowIndex })
                          }
                          value={cell}
                        />
                      ) : (
                        <button
                          aria-label={cellLabel}
                          className={cn(
                            "flex h-7 w-full min-w-[6.5rem] items-center overflow-hidden text-ellipsis whitespace-nowrap bg-transparent px-1.5 text-foreground outline-none",
                            alignClass
                          )}
                          onClick={() =>
                            setSelected({ col: columnIndex, row: rowIndex })
                          }
                          type="button"
                        >
                          {cell}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ArtifactSpreadsheetEditor({
  busy,
  content,
  error,
  filename,
  onCancel,
  onSave,
}: {
  busy: boolean;
  content: string;
  error: string | null;
  filename: string;
  onCancel: () => void;
  onSave: (nextContent: string) => void;
}) {
  const [rows, setRows] = useState<SpreadsheetRows>(() =>
    parseSpreadsheetText(filename, content)
  );
  const [baseRows, setBaseRows] = useState<SpreadsheetRows>(() =>
    structuredClone(parseSpreadsheetText(filename, content))
  );

  useEffect(() => {
    const next = parseSpreadsheetText(filename, content);
    setRows(next);
    setBaseRows(structuredClone(next));
  }, [content, filename]);

  const isDirty = JSON.stringify(rows) !== JSON.stringify(baseRows);

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setRows((current) =>
      normalizeSpreadsheetShape(
        current.map((row, currentRowIndex) => {
          if (currentRowIndex !== rowIndex) {
            return row;
          }

          const length = Math.max(row.length, columnIndex + 1);
          return Array.from({ length }, (_, currentColumnIndex) =>
            currentColumnIndex === columnIndex
              ? value
              : (row[currentColumnIndex] ?? "")
          );
        })
      )
    );
  }

  function addRow() {
    setRows((current) =>
      normalizeSpreadsheetShape([
        ...current,
        Array.from({ length: Math.max(1, current[0]?.length ?? 1) }, () => ""),
      ])
    );
  }

  function addColumn() {
    setRows((current) =>
      normalizeSpreadsheetShape(current.map((row) => [...row, ""]))
    );
  }

  function discard() {
    setRows(structuredClone(baseRows));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <p className="shrink-0 border-border border-b px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
        <Button
          disabled={busy}
          onClick={addRow}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Add01Icon aria-hidden className="size-3" />
          Row
        </Button>
        <Button
          disabled={busy}
          onClick={addColumn}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Add01Icon aria-hidden className="size-3" />
          Column
        </Button>
        <div className="min-w-0 flex-1" />
        <Button
          disabled={busy}
          onClick={isDirty ? discard : onCancel}
          size="xs"
          type="button"
          variant="ghost"
        >
          {isDirty ? "Discard" : "Cancel"}
        </Button>
        <Button
          disabled={busy || !isDirty}
          onClick={() => onSave(serializeSpreadsheetText(filename, rows))}
          size="xs"
          type="button"
        >
          {busy ? <Spinner className="size-3.5" /> : "Save"}
        </Button>
      </div>

      <SpreadsheetGrid editable={!busy} onChangeCell={updateCell} rows={rows} />
    </div>
  );
}
