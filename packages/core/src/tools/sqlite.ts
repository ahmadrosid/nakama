import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { ensureDir } from "../fs";
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
