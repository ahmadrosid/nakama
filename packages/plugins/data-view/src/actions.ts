import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { PluginExecutionContext } from "@nakama/core";

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = { [key: string]: JsonValue };

type Grid = string[][];

type GoogleSheetsRequest =
  | { op: "google_sheets"; action: "info"; spreadsheetId: string }
  | {
      op: "google_sheets";
      action: "read";
      range: string;
      spreadsheetId: string;
    }
  | {
      op: "google_sheets";
      action: "write";
      data: { range: string; values: string[][] }[];
      spreadsheetId: string;
    };

type Context = PluginExecutionContext & {
  actionKey: string;
  host(request: GoogleSheetsRequest): Promise<JsonValue>;
};

type SheetRow = {
  id: string;
  url: string;
  spreadsheet_id: string;
  gid: string;
  title: string;
  tab_title: string | null;
  base: string;
  data: string;
  fetched_at: number;
  synced_at: number | null;
};

type CellChange = { row: number; column: number; value: string };

const SHEET_URL = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

const GID = /[#&?]gid=(\d+)/;

const COLUMN_LETTERS = /^[A-Z]{1,3}$/;

const PAGE_TITLE = /<meta property="og:title" content="([^"]*)"/;

// The plugin runner keeps 1,000,000 characters of output; a sheet answer must fit.
const MAX_GRID_CHARS = 400_000;

const MAX_READ_ROWS = 200;

export function parseSheetUrl(url: string) {
  const id = SHEET_URL.exec(url)?.[1];

  if (!(id && url.startsWith("https://docs.google.com/"))) {
    throw new Error("Paste a docs.google.com/spreadsheets link.");
  }

  return { gid: GID.exec(url)?.[1] ?? "0", spreadsheetId: id };
}

export function parseCsv(text: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index++;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function columnLetter(column: number): string {
  let letters = "";

  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }

  return letters;
}

function columnIndex(column: string, header: string[]): number {
  const byName = header.indexOf(column);

  if (byName >= 0) {
    return byName;
  }

  const letters = column.trim().toUpperCase();

  if (!COLUMN_LETTERS.test(letters)) {
    throw new Error(`Column not found: ${column}`);
  }

  return (
    [...letters].reduce(
      (total, char) => total * 26 + char.charCodeAt(0) - 64,
      0
    ) - 1
  );
}

function cell(grid: Grid, row: number, column: number): string {
  return grid[row]?.[column] ?? "";
}

/** Cells that differ between the fetched copy and the edited copy, 0-based. */
export function changedCells(base: Grid, data: Grid): CellChange[] {
  const changes: CellChange[] = [];

  for (let row = 0; row < Math.max(base.length, data.length); row++) {
    const width = Math.max(base[row]?.length ?? 0, data[row]?.length ?? 0);

    for (let column = 0; column < width; column++) {
      const value = cell(data, row, column);

      if (value !== cell(base, row, column)) {
        changes.push({ column, row, value });
      }
    }
  }

  return changes;
}

function changedKeys(base: string, data: Grid) {
  return changedCells(JSON.parse(base), data).map(
    (change) => `${change.row}:${change.column}`
  );
}

function normalizeGrid(grid: Grid): Grid {
  const width = Math.max(1, ...grid.map((row) => row.length));
  const rows = grid.length ? grid : [[]];

  return rows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? "")
  );
}

function assertGridSize(grid: Grid) {
  if (JSON.stringify(grid).length > MAX_GRID_CHARS) {
    throw new Error("This sheet is too large for Data View.");
  }
}

function quoteTab(title: string) {
  return `'${title.replaceAll("'", "''")}'`;
}

function findValue(value: JsonValue, key: string): JsonValue | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findValue(entry, key);

      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  if (!(value instanceof Object)) {
    return undefined;
  }

  if (key in value) {
    return value[key];
  }

  for (const entry of Object.values(value)) {
    const found = findValue(entry, key);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function toGrid(value: JsonValue | undefined): Grid {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((row) =>
    Array.isArray(row)
      ? row.map((entry) => (entry === null ? "" : String(entry)))
      : []
  );
}

/** Shows Google's reason (not connected, no access) instead of a generic host failure. */
async function callSheets(context: Context, request: GoogleSheetsRequest) {
  try {
    return await context.host(request);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

async function spreadsheetInfo(
  context: Context,
  spreadsheetId: string,
  gid: string
) {
  const info = await callSheets(context, {
    action: "info",
    op: "google_sheets",
    spreadsheetId,
  });

  const sheets = findValue(info, "sheets");

  const tab = (Array.isArray(sheets) ? sheets : [])
    .map((entry) => findValue(entry, "properties"))
    .find(
      (properties) =>
        properties instanceof Object &&
        !Array.isArray(properties) &&
        String(properties.sheetId) === gid
    );

  const tabTitle =
    tab instanceof Object && !Array.isArray(tab) ? tab.title : undefined;

  if (tabTitle !== String(tabTitle)) {
    throw new Error("Could not find this tab in the spreadsheet.");
  }

  const title = findValue(info, "title");

  return {
    tabTitle,
    title: title === String(title) ? title : tabTitle,
  };
}

async function fetchPublic(spreadsheetId: string, gid: string) {
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`
  );

  if (!(response.ok && response.headers.get("content-type")?.includes("csv"))) {
    return null;
  }

  const grid = parseCsv(await response.text());
  let title = "Untitled sheet";

  try {
    const page = await fetch(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    );

    const found = PAGE_TITLE.exec(await page.text())?.[1]?.trim();

    title =
      found
        ?.replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&") || title;
  } catch {
    // The title is a label only; the data already arrived.
  }

  return { grid, tabTitle: null, title };
}

/** Public sheets download for free; private ones read once through Composio. */
async function fetchSheet(
  context: Context,
  spreadsheetId: string,
  gid: string
) {
  const fetched = await fetchPublic(spreadsheetId, gid);

  if (fetched) {
    return fetched;
  }

  let info: { tabTitle: string; title: string };

  try {
    info = await spreadsheetInfo(context, spreadsheetId, gid);
  } catch (error) {
    throw new Error(
      `Could not open this sheet. Share it as "Anyone with the link", or connect Google Sheets in Composio. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const values = await callSheets(context, {
    action: "read",
    op: "google_sheets",
    range: quoteTab(info.tabTitle),
    spreadsheetId,
  });

  return { grid: toGrid(findValue(values, "values")), ...info };
}

function summary(row: SheetRow) {
  const data: Grid = JSON.parse(row.data);

  return {
    columns: data[0] ?? [],
    fetchedAt: row.fetched_at,
    id: row.id,
    pendingEdits: changedCells(JSON.parse(row.base), data).length,
    rows: Math.max(0, data.length - 1),
    syncedAt: row.synced_at,
    title: row.title,
    url: row.url,
  };
}

function text(value: JsonValue | undefined, name: string): string {
  if (value !== String(value) || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function count(value: JsonValue | undefined, fallback: number) {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function readSheet(row: SheetRow, input: JsonRecord) {
  const data: Grid = JSON.parse(row.data);
  const query = input.query === String(input.query) ? input.query.trim() : "";
  const needle = query.toLowerCase();

  const matches = data
    .slice(1)
    .map((values, index) => ({ row: index + 2, values }))
    .filter(
      (entry) =>
        !needle ||
        entry.values.some((value) => value.toLowerCase().includes(needle))
    );

  const offset = count(input.offset, 0);
  const limit = Math.min(count(input.limit, 50), MAX_READ_ROWS);

  return {
    columns: data[0] ?? [],
    rows: matches.slice(offset, offset + limit),
    sheetId: row.id,
    title: row.title,
    total: matches.length,
  };
}

function applyEdits(row: SheetRow, edits: JsonValue | undefined): Grid {
  if (!(Array.isArray(edits) && edits.length)) {
    throw new Error("Missing edits.");
  }

  const data: Grid = JSON.parse(row.data);
  const width = Math.max(1, data[0]?.length ?? 0);

  for (const edit of edits) {
    if (!(edit instanceof Object) || Array.isArray(edit)) {
      throw new Error("Each edit needs row, column, and value.");
    }

    const target = count(edit.row, 0);

    if (target < 1 || target > data.length + 1) {
      throw new Error(`Row ${String(edit.row)} is outside the sheet.`);
    }

    const column = columnIndex(text(edit.column, "column"), data[0] ?? []);

    if (target === data.length + 1) {
      data.push(Array.from({ length: width }, () => ""));
    }

    const cells = data[target - 1]!;

    while (cells.length <= column) {
      cells.push("");
    }

    cells[column] = edit.value === null ? "" : String(edit.value);
  }

  const next = normalizeGrid(data);
  assertGridSize(next);

  return next;
}

export async function run(
  input: JsonRecord,
  context: Context
): Promise<JsonValue> {
  if (!context.databasePath) {
    throw new Error("Data View database is unavailable.");
  }

  const db = new Database(context.databasePath);

  const load = (id: JsonValue | undefined) => {
    const row = db
      .query<SheetRow, [string]>("SELECT * FROM sheets WHERE id = ?")
      .get(text(id, "sheetId"));

    if (!row) {
      throw new Error("Sheet not found.");
    }

    return row;
  };

  try {
    if (context.actionKey === "list_sheets") {
      return db
        .query<SheetRow, []>("SELECT * FROM sheets ORDER BY fetched_at DESC")
        .all()
        .map(summary);
    }

    if (context.actionKey === "add_sheet") {
      const url = text(input.url, "url");
      const { gid, spreadsheetId } = parseSheetUrl(url);

      const existing = db
        .query<SheetRow, [string, string]>(
          "SELECT * FROM sheets WHERE spreadsheet_id = ? AND gid = ?"
        )
        .get(spreadsheetId, gid);

      if (existing) {
        return summary(existing);
      }

      const fetched = await fetchSheet(context, spreadsheetId, gid);
      const grid = normalizeGrid(fetched.grid);
      assertGridSize(grid);
      const id = randomUUID();
      const name = input.name === String(input.name) ? input.name.trim() : "";

      db.query(
        "INSERT INTO sheets (id, url, spreadsheet_id, gid, title, tab_title, base, data, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id,
        url,
        spreadsheetId,
        gid,
        name || fetched.title,
        fetched.tabTitle,
        JSON.stringify(grid),
        JSON.stringify(grid),
        Date.now()
      );

      return summary(load(id));
    }

    const row = load(input.sheetId);

    if (context.actionKey === "read_sheet") {
      return readSheet(row, input);
    }

    if (context.actionKey === "get_sheet") {
      const data: Grid = JSON.parse(row.data);

      return { ...summary(row), changed: changedKeys(row.base, data), data };
    }

    if (context.actionKey === "update_cells") {
      const data = applyEdits(row, input.edits);

      db.query("UPDATE sheets SET data = ? WHERE id = ?").run(
        JSON.stringify(data),
        row.id
      );

      return { ...summary(load(row.id)), changed: changedKeys(row.base, data) };
    }

    if (context.actionKey === "delete_sheet") {
      db.query("DELETE FROM sheets WHERE id = ?").run(row.id);

      return { deleted: true };
    }

    if (context.actionKey === "refresh_sheet") {
      const pending = summary(row).pendingEdits;

      if (pending && input.discardEdits !== true) {
        throw new Error(`Sync or discard ${pending} unsynced edits first.`);
      }

      const fetched = await fetchSheet(context, row.spreadsheet_id, row.gid);
      const grid = normalizeGrid(fetched.grid);
      assertGridSize(grid);

      db.query(
        "UPDATE sheets SET base = ?, data = ?, fetched_at = ?, tab_title = COALESCE(?, tab_title) WHERE id = ?"
      ).run(
        JSON.stringify(grid),
        JSON.stringify(grid),
        Date.now(),
        fetched.tabTitle,
        row.id
      );

      return summary(load(row.id));
    }

    if (context.actionKey === "sync_sheet") {
      const data: Grid = JSON.parse(row.data);
      const changes = changedCells(JSON.parse(row.base), data);

      if (!changes.length) {
        return { ...summary(row), written: 0 };
      }

      const tabTitle =
        row.tab_title ??
        (await spreadsheetInfo(context, row.spreadsheet_id, row.gid)).tabTitle;

      await callSheets(context, {
        action: "write",
        data: changes.map((change) => ({
          range: `${quoteTab(tabTitle)}!${columnLetter(change.column)}${change.row + 1}`,
          values: [[change.value]],
        })),
        op: "google_sheets",
        spreadsheetId: row.spreadsheet_id,
      });

      // Edits saved while the write ran stay unsynced: base takes only what was sent.
      db.query(
        "UPDATE sheets SET base = ?, tab_title = ?, synced_at = ? WHERE id = ?"
      ).run(row.data, tabTitle, Date.now(), row.id);

      return { ...summary(load(row.id)), written: changes.length };
    }

    throw new Error("Unknown Data View action.");
  } finally {
    db.close();
  }
}
