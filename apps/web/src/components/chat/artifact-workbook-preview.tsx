import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  parseXlsxPreview,
  type WorkbookPreview,
  XLSX_PREVIEW_MAX_BYTES,
} from "@/lib/artifact-office-preview";
import { columnIndexToLetter } from "@/lib/artifact-spreadsheet";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";

export function ArtifactWorkbookPreview({
  artifact,
  profileId,
}: {
  artifact: ChatArtifactRef;
  profileId: string;
}) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id;
  const [workbook, setWorkbook] = useState<WorkbookPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setWorkbook(null);
    setError(null);
    void client
      .forOrg(orgId ?? null)
      .readProfileArtifactContent(profileId, artifact.path, {
        inline: true,
        maxBytes: XLSX_PREVIEW_MAX_BYTES,
        signal: controller.signal,
      })
      .then((result) => parseXlsxPreview(result.data))
      .then((parsed) => {
        if (!controller.signal.aborted) {
          setWorkbook(parsed);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(formatError(reason));
        }
      });

    return () => controller.abort();
  }, [profileId, artifact.path, orgId]);

  if (error) {
    return (
      <p className="p-4 text-destructive text-sm" role="alert">
        {error} You can still download the original workbook.
      </p>
    );
  }

  if (!workbook) {
    return (
      <div
        className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground text-sm"
        role="status"
      >
        <Spinner className="size-4" />
        Loading workbook…
      </div>
    );
  }

  return (
    <WorkbookGrid key={`${profileId}:${artifact.path}`} workbook={workbook} />
  );
}

export function WorkbookGrid({ workbook }: { workbook: WorkbookPreview }) {
  const panelId = useId();
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selected, setSelected] = useState({ column: 0, row: 0 });
  const [zoom, setZoom] = useState(100);
  const grid = useRef<HTMLDivElement>(null);
  const sheet = workbook.sheets[sheetIndex];
  const rowCount = Math.max(24, sheet.rows.length);
  const columnCount = Math.max(6, sheet.columns);
  const cell = sheet.rows[selected.row]?.[selected.column];
  const address = `${columnIndexToLetter(selected.column)}${selected.row + 1}`;

  const selectCell = useCallback((column: number, row: number) => {
    setSelected({ column, row });
  }, []);

  function selectSheet(index: number) {
    setSheetIndex(index);
    setSelected({ column: 0, row: 0 });
    grid.current?.scrollTo?.({ left: 0, top: 0 });
  }

  return (
    <div
      aria-label="Workbook preview"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-border border-b bg-muted/30 px-3 py-2">
        <span className="min-w-0 truncate text-muted-foreground text-xs">
          Read-only · Saved formula values
        </span>
        <label className="flex items-center gap-2 text-xs">
          Zoom
          <select
            aria-label="Spreadsheet zoom"
            className="min-h-9 rounded-md border border-border bg-background px-2"
            onChange={(event) => setZoom(Number(event.target.value))}
            value={zoom}
          >
            {[75, 100, 125, 150, 200].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex min-h-11 items-center gap-3 border-border border-b px-3 font-mono text-xs">
        <span className="w-12 shrink-0 text-muted-foreground">{address}</span>
        <span aria-hidden className="text-muted-foreground italic">
          fx
        </span>
        <output
          aria-label="Selected cell value"
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2"
        >
          {cell?.formula ?? cell?.value ?? ""}
        </output>
      </div>
      <div
        aria-labelledby={`${panelId}-${sheetIndex}`}
        className="min-h-0 flex-1 overflow-auto bg-white text-slate-950"
        id={panelId}
        ref={grid}
        role="tabpanel"
      >
        <table
          aria-label={`${sheet.name} worksheet`}
          className="w-max min-w-full border-separate border-spacing-0"
          onKeyDown={(event) => {
            const direction = new Map<string, [number, number]>([
              ["ArrowDown", [1, 0]],
              ["ArrowLeft", [0, -1]],
              ["ArrowRight", [0, 1]],
              ["ArrowUp", [-1, 0]],
            ]).get(event.key);

            if (!direction) {
              return;
            }

            event.preventDefault();

            const next = {
              column: Math.max(
                0,
                Math.min(columnCount - 1, selected.column + direction[1])
              ),
              row: Math.max(
                0,
                Math.min(rowCount - 1, selected.row + direction[0])
              ),
            };

            setSelected(next);
            grid.current
              ?.querySelector<HTMLButtonElement>(
                `[data-cell="${next.row}:${next.column}"]`
              )
              ?.focus();
          }}
          style={{ fontSize: (13 * zoom) / 100 }}
        >
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                aria-label="Row numbers"
                className="sticky left-0 z-30 min-w-10 border-slate-200 border-r border-b bg-slate-100"
              />
              {Array.from({ length: columnCount }, (_, column) => (
                <th
                  className="border-slate-200 border-r border-b bg-slate-100 px-3 py-2 font-normal"
                  key={column}
                  scope="col"
                >
                  {columnIndexToLetter(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <WorkbookRow
                columnCount={columnCount}
                key={row}
                onSelect={selectCell}
                row={row}
                selectedColumn={selected.row === row ? selected.column : -1}
                values={sheet.rows[row]}
                zoom={zoom}
              />
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated ? (
        <p
          className="border-border border-t px-3 py-2 text-muted-foreground text-xs"
          role="status"
        >
          Preview limited to 500 rows and 50 columns. Download the workbook for
          all data.
        </p>
      ) : null}
      <div
        aria-label="Workbook sheets"
        className="flex shrink-0 gap-1 overflow-x-auto border-border border-t bg-muted/30 px-2 py-2"
        role="tablist"
      >
        {workbook.sheets.map((entry, index) => (
          <button
            aria-controls={panelId}
            aria-selected={index === sheetIndex}
            className={cn(
              "min-h-11 shrink-0 rounded-md px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              index === sheetIndex
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
            id={`${panelId}-${index}`}
            key={entry.name}
            onClick={() => selectSheet(index)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                return;
              }

              event.preventDefault();

              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? workbook.sheets.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        workbook.sheets.length) %
                      workbook.sheets.length;

              selectSheet(next);
              // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
              (
                event.currentTarget.parentElement?.children[next] as
                  | HTMLButtonElement
                  | undefined
              )?.focus();
            }}
            role="tab"
            tabIndex={index === sheetIndex ? 0 : -1}
            type="button"
          >
            {entry.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const WorkbookRow = memo(function WorkbookRow({
  row,
  values,
  columnCount,
  selectedColumn,
  zoom,
  onSelect,
}: {
  row: number;
  values: WorkbookPreview["sheets"][number]["rows"][number] | undefined;
  columnCount: number;
  selectedColumn: number;
  zoom: number;
  onSelect: (column: number, row: number) => void;
}) {
  return (
    <tr>
      <th
        className="sticky left-0 z-10 border-slate-200 border-r border-b bg-slate-100 px-3 font-normal text-slate-500"
        scope="row"
      >
        {row + 1}
      </th>
      {Array.from({ length: columnCount }, (_, column) => {
        const value = values?.[column];

        const active = selectedColumn === column;

        return (
          <td className="border-slate-200 border-r border-b p-0" key={column}>
            <button
              aria-label={`${columnIndexToLetter(column)}${row + 1}: ${value?.value ?? ""}`}
              aria-pressed={active}
              className={cn(
                "block w-full min-w-36 max-w-80 truncate px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset",
                active && "ring-2 ring-blue-600 ring-inset"
              )}
              data-cell={`${row}:${column}`}
              onClick={() => onSelect(column, row)}
              style={{
                backgroundColor: value?.background,
                color: value?.color,
                fontWeight: value?.bold ? 600 : undefined,
                height: (34 * zoom) / 100,
              }}
              tabIndex={active ? 0 : -1}
              title={value?.value}
              type="button"
            >
              {value?.value || "\u00a0"}
            </button>
          </td>
        );
      })}
    </tr>
  );
});
