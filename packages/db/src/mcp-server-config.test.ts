import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "./index";
import type { StoredMcpServerRecord } from "./types";

const SECRET = "sk_live_do_not_store_plain";

function serverRecord(id: string): StoredMcpServerRecord {
  const now = new Date().toISOString();

  return {
    cachedTools: [],
    config: {
      headers: { Authorization: `Bearer ${SECRET}` },
      url: "https://mcp.example.com/mcp",
    },
    createdAt: now,
    enabled: true,
    id,
    lastError: null,
    name: id,
    status: "disconnected",
    transport: "http",
    updatedAt: now,
  };
}

describe("MCP server config at rest", () => {
  let rootDir = "";
  let previousConfigDir: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-mcp-config-"));
    previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = rootDir;
  });

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    await rm(rootDir, { force: true, recursive: true });
  });

  test("stores config encrypted and reads it back in plain form", async () => {
    const sqlitePath = join(rootDir, "nakama.sqlite");
    const database = await createDatabase(`file:${sqlitePath}`);
    const record = serverRecord("mcp-1");

    await database.adapter.upsertMcpServer(record);

    const raw = new Database(sqlitePath, { readonly: true })
      .query<{ config: string }, [string]>(
        "SELECT config FROM mcp_servers WHERE id = ?"
      )
      .get("mcp-1");

    expect(raw?.config).not.toContain(SECRET);
    expect(raw?.config).not.toContain("mcp.example.com");
    expect((await database.adapter.getMcpServer("mcp-1"))?.config).toEqual(
      record.config
    );
    expect(
      (await database.adapter.listMcpServers()).map((server) => server.config)
    ).toEqual([record.config]);

    database.close();
  });

  test("reads a config saved before encryption", async () => {
    const sqlitePath = join(rootDir, "nakama.sqlite");
    const database = await createDatabase(`file:${sqlitePath}`);
    const record = serverRecord("mcp-legacy");

    await database.adapter.upsertMcpServer(record);
    new Database(sqlitePath)
      .query("UPDATE mcp_servers SET config = ? WHERE id = ?")
      .run(JSON.stringify(record.config), "mcp-legacy");

    expect((await database.adapter.getMcpServer("mcp-legacy"))?.config).toEqual(
      record.config
    );

    database.close();
  });

  test("a config copied to another server row does not decrypt", async () => {
    const sqlitePath = join(rootDir, "nakama.sqlite");
    const database = await createDatabase(`file:${sqlitePath}`);

    await database.adapter.upsertMcpServer(serverRecord("mcp-a"));
    await database.adapter.upsertMcpServer(serverRecord("mcp-b"));

    const sqlite = new Database(sqlitePath);
    sqlite
      .query(
        "UPDATE mcp_servers SET config = (SELECT config FROM mcp_servers WHERE id = 'mcp-a') WHERE id = 'mcp-b'"
      )
      .run();

    await expect(database.adapter.getMcpServer("mcp-b")).rejects.toThrow();

    database.close();
  });
});
