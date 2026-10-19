import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonRecord, type JsonValue, parseCsv, run } from "./actions";

const SHEET = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=42";

const originalFetch = globalThis.fetch;

let dir: string;

let context: Parameters<typeof run>[1];

let hostCalls: JsonRecord[];

let csv: string | null;

const invoke = async (actionKey: string, input: JsonRecord = {}) =>
  record(await run(input, { ...context, actionKey }));

function record(value: JsonValue): JsonRecord {
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }

  return value;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nakama-data-view-"));
  const databasePath = join(dir, "plugin.sqlite");
  const db = new Database(databasePath);
  db.exec(
    readFileSync(
      new URL("../migrations/001-data-view.sql", import.meta.url),
      "utf8"
    )
  );
  db.close();
  csv = "Name,Score\nAda,1\nGrace,2\n";
  hostCalls = [];
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request) =>
      String(url).includes("export?format=csv") && csv !== null
        ? new Response(csv, { headers: { "content-type": "text/csv" } })
        : new Response(
            '<meta property="og:title" content="Scores &amp; ranks">',
            {
              headers: { "content-type": "text/html" },
            }
          ),
    { preconnect: originalFetch.preconnect }
  );
  context = {
    actionKey: "",
    actor: { id: "member", role: "member" },
    apiVersion: 1,
    databasePath,
    dataDir: dir,
    host: async (request): Promise<JsonValue> => {
      hostCalls.push(request);

      if (request.action === "info") {
        return {
          properties: { title: "Private scores" },
          sheets: [{ properties: { sheetId: 42, title: "Q1 'final'" } }],
        };
      }

      if (request.action === "read") {
        return { valueRanges: [{ values: [["Name"], ["Lin"]] }] };
      }

      return { totalUpdatedCells: 1 };
    },
    invocationId: "test",
    orgId: "org",
    pluginId: "data-view",
    pluginVersion: "0.1.0",
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(dir, { force: true, recursive: true });
});

test("parses quoted CSV cells with commas, quotes, and newlines", () => {
  expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4')).toEqual([
    ["a", "b, c", 'say "hi"', "two\nlines"],
    ["1", "2", "3", "4"],
  ]);
});

test("a public sheet is saved once and read from the copy", async () => {
  const added = await invoke("add_sheet", { url: SHEET });
  expect(added).toMatchObject({
    pendingEdits: 0,
    rows: 2,
    title: "Scores & ranks",
  });

  csv = null;
  expect(await invoke("add_sheet", { url: SHEET })).toMatchObject({
    id: added.id,
  });

  const read = await invoke("read_sheet", {
    query: "grace",
    sheetId: String(added.id),
  });

  expect(read).toMatchObject({
    columns: ["Name", "Score"],
    rows: [{ row: 3, values: ["Grace", "2"] }],
    total: 1,
  });
  expect(hostCalls).toEqual([]);
});

test("edits stay local until sync writes only the changed cells", async () => {
  const { id } = await invoke("add_sheet", { url: SHEET });
  const sheetId = String(id);

  const edited = await invoke("update_cells", {
    edits: [
      { column: "Score", row: 2, value: "10" },
      { column: "A", row: 4, value: "Linus" },
    ],
    sheetId,
  });

  expect(edited).toMatchObject({ changed: ["1:1", "3:0"], pendingEdits: 2 });
  expect(hostCalls).toEqual([]);

  await expect(invoke("refresh_sheet", { sheetId })).rejects.toThrow();

  const synced = await invoke("sync_sheet", { sheetId });
  expect(synced).toMatchObject({ pendingEdits: 0, written: 2 });
  expect(hostCalls.at(-1)).toEqual({
    action: "write",
    data: [
      { range: "'Q1 ''final'''!B2", values: [["10"]] },
      { range: "'Q1 ''final'''!A4", values: [["Linus"]] },
    ],
    op: "google_sheets",
    spreadsheetId: "abc123",
  });

  const sheet = await invoke("get_sheet", { sheetId });
  expect(sheet.data).toEqual([
    ["Name", "Score"],
    ["Ada", "10"],
    ["Grace", "2"],
    ["Linus", ""],
  ]);
});

test("a private sheet reads once through the connected account", async () => {
  csv = null;
  const added = await invoke("add_sheet", { url: SHEET });

  expect(added).toMatchObject({ rows: 1, title: "Private scores" });
  expect(hostCalls.map((call) => call.action)).toEqual(["info", "read"]);
  expect(hostCalls[1]).toMatchObject({ range: "'Q1 ''final'''" });
});

test("rows past the end and unknown columns are refused", async () => {
  const { id } = await invoke("add_sheet", { url: SHEET });
  const sheetId = String(id);

  await expect(
    invoke("update_cells", {
      edits: [{ column: "A", row: 9, value: "x" }],
      sheetId,
    })
  ).rejects.toThrow();
  await expect(
    invoke("update_cells", {
      edits: [{ column: "Missing column", row: 2, value: "x" }],
      sheetId,
    })
  ).rejects.toThrow();
  expect(await invoke("get_sheet", { sheetId })).toMatchObject({
    pendingEdits: 0,
  });
});
