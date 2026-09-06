import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrgWorkflowSqlitePath, runSqliteTool } from "./sqlite";

const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }
});

describe("sqlite tool", () => {
  test("returns columns and rows for SELECT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-sqlite-"));
    const databasePath = join(dir, "workflow-data.sqlite");
    try {
      await runSqliteTool(
        { sql: "CREATE TABLE items (name TEXT)" },
        { orgId: "org_test" },
        { databasePath }
      );
      await runSqliteTool(
        { params: ["alpha"], sql: "INSERT INTO items (name) VALUES (?)" },
        { orgId: "org_test" },
        { databasePath }
      );
      const selected = await runSqliteTool(
        { sql: "SELECT name FROM items" },
        { orgId: "org_test" },
        { databasePath }
      );
      expect(selected).toEqual({
        columns: ["name"],
        rows: [{ name: "alpha" }],
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("rejects ATTACH and multiple statements", async () => {
    await expect(
      runSqliteTool(
        { sql: "ATTACH DATABASE '/tmp/other.sqlite' AS other" },
        { orgId: "org_test" },
        { databasePath: ":memory:" }
      )
    ).rejects.toThrow("ATTACH");

    await expect(
      runSqliteTool(
        { sql: "SELECT 1; SELECT 2" },
        { orgId: "org_test" },
        { databasePath: ":memory:" }
      )
    ).rejects.toThrow("one SQL statement");
  });

  test("requires orgId when no override path is given", async () => {
    await expect(runSqliteTool({ sql: "SELECT 1" }, {})).rejects.toThrow(
      "orgId"
    );
  });

  test("resolves a per-org file under the config dir", async () => {
    process.env.NAKAMA_CONFIG_DIR = "/tmp/nakama-config-test";
    expect(getOrgWorkflowSqlitePath("org_abc")).toBe(
      join("/tmp/nakama-config-test", "orgs", "org_abc", "workflow-data.sqlite")
    );
  });
});
