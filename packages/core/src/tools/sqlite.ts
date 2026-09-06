import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { z } from "zod";
import type {
  ToolContext,
  ToolDefinition,
  WorkflowSqliteInspectResponse,
  WorkflowSqlitePreview,
  WorkflowSqliteTableInfo,
} from "../contract";
import { ensureDir, pathExists } from "../fs";
import { assertConfigPathSegment } from "../soul/resolve";
import { getUserConfigDir } from "../user-config";
import {
  jsonSchemaFromZod,
  parseToolInput,
  requiredTrimmedString,
} from "./schema";

export const sqliteInputSchema = z
  .object({
    params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    sql: requiredTrimmedString("sql"),
  })
  .partial({ params: true })
  .strict();

export function getOrgWorkflowSqlitePath(orgId: string): string {
  return join(
    getUserConfigDir(),
    "orgs",
    assertConfigPathSegment(orgId, "orgId"),
    "workflow-data.sqlite"
  );
}

export const sqliteTool: ToolDefinition = {
  description:
    "Run one SQL statement against this organization's workflow SQLite file. Not the product database. Use params for bound values.",
  name: "sqlite",
  parameters: jsonSchemaFromZod(sqliteInputSchema),
  run: runSqliteTool,
};

export async function runSqliteTool(
  input: unknown,
  context: ToolContext,
  options: { databasePath?: string } = {}
): Promise<unknown> {
  const parsed = parseToolInput(sqliteInputSchema, input);
  const sql = assertSafeSql(parsed.sql);
  const params = parsed.params ?? [];
  let databasePath = options.databasePath;
  if (!databasePath) {
    const orgId = context.orgId?.trim();
    if (!orgId) {
      throw new Error("orgId is required.");
    }
    databasePath = getOrgWorkflowSqlitePath(orgId);
  }

  if (databasePath !== ":memory:") {
    await ensureDir(dirname(databasePath));
  }

  const db = new Database(databasePath);
  try {
    const statement = db.query(sql);
    if (isRowsStatement(sql)) {
      const rows = (
        params.length > 0 ? statement.all(...params) : statement.all()
      ) as Record<string, unknown>[];
      return { columns: statement.columnNames, rows };
    }

    const result =
      params.length > 0 ? statement.run(...params) : statement.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  } finally {
    db.close();
  }
}

function assertSafeSql(sql: string): string {
  const body = sql.trim().replace(/;$/, "").trimEnd();
  if (/\bATTACH\b/i.test(body)) {
    throw new Error("ATTACH is not allowed.");
  }
  if (body.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }
  return body;
}

function isRowsStatement(sql: string): boolean {
  return /^(WITH|SELECT|EXPLAIN|PRAGMA|VALUES)\b/i.test(sql);
}

const WORKFLOW_SQLITE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WORKFLOW_SQLITE_PREVIEW_LIMIT = 50;

export async function inspectWorkflowSqlite(
  orgId: string,
  options: { databasePath?: string; limit?: number; table?: string } = {}
): Promise<WorkflowSqliteInspectResponse> {
  const databasePath = options.databasePath ?? getOrgWorkflowSqlitePath(orgId);
  if (databasePath !== ":memory:" && !(await pathExists(databasePath))) {
    if (options.table) {
      throw new Error("Table not found.");
    }
    return { preview: null, tables: [] };
  }

  const db =
    databasePath === ":memory:"
      ? new Database(databasePath)
      : new Database(databasePath, { readonly: true });
  try {
    const tables = listWorkflowSqliteTables(db);
    const requested = options.table?.trim();
    if (!requested) {
      return { preview: null, tables };
    }
    if (!tables.some((entry) => entry.name === requested)) {
      throw new Error("Table not found.");
    }
    return {
      preview: previewWorkflowSqliteTable(db, requested, options.limit),
      tables,
    };
  } finally {
    db.close();
  }
}

function listWorkflowSqliteTables(db: Database): WorkflowSqliteTableInfo[] {
  const names = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>;
  return names.map((entry) => ({
    name: entry.name,
    rowCount: Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM ${quoteSqliteIdent(entry.name)}`
          )
          .get() as {
          count: number;
        }
      ).count
    ),
  }));
}

function previewWorkflowSqliteTable(
  db: Database,
  table: string,
  limit = WORKFLOW_SQLITE_PREVIEW_LIMIT
): WorkflowSqlitePreview {
  const ident = quoteSqliteIdent(table);
  const total = Number(
    (
      db.query(`SELECT COUNT(*) AS count FROM ${ident}`).get() as {
        count: number;
      }
    ).count
  );
  const capped = Math.min(
    Math.max(1, Math.trunc(limit)),
    WORKFLOW_SQLITE_PREVIEW_LIMIT
  );
  const statement = db.query(`SELECT * FROM ${ident} LIMIT ${capped}`);
  return {
    columns: statement.columnNames,
    rows: statement.all() as Record<string, unknown>[],
    table,
    total,
  };
}

function quoteSqliteIdent(name: string): string {
  if (!WORKFLOW_SQLITE_TABLE_NAME.test(name)) {
    throw new Error("Table not found.");
  }
  return `"${name}"`;
}
