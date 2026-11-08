import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createInMemoryDatabaseAdapter,
  type StoredMcpServerRecord,
} from "@nakama/db";
import { ManagedSecrets } from "./managed-secrets";
import { installMcpSecretStore } from "./mcp-secret-store";

const TOKEN = "access-token-that-must-not-be-stored-in-clear";

function server(id: string): StoredMcpServerRecord {
  const now = new Date().toISOString();

  return {
    cachedTools: [],
    config: {
      headers: { Authorization: `Bearer ${TOKEN}` },
      oauth: { tokens: { access_token: TOKEN, token_type: "Bearer" } },
      url: "https://mcp.example.com/mcp",
    },
    createdAt: now,
    enabled: true,
    id,
    lastError: null,
    name: id,
    status: "connected",
    transport: "http",
    updatedAt: now,
  };
}

async function setup() {
  const db = createInMemoryDatabaseAdapter();
  const secrets = new ManagedSecrets(db, randomBytes(32).toString("base64"));
  const raw = db.getMcpServer.bind(db);

  return { db, raw, secrets };
}

describe("MCP secret store", () => {
  test("the stored row holds no credential, and reads get it back", async () => {
    const { db, raw, secrets } = await setup();
    await installMcpSecretStore(db, secrets, true);

    await db.upsertMcpServer(server("mcp_1"));

    expect(JSON.stringify((await raw("mcp_1"))?.config)).not.toContain(TOKEN);
    expect(JSON.stringify(await db.listManagedSecrets())).not.toContain(TOKEN);
    expect((await db.getMcpServer("mcp_1"))?.config).toEqual(
      server("mcp_1").config
    );
    expect((await db.listMcpServers())[0]?.config).toEqual(
      server("mcp_1").config
    );
  });

  test("rows written before the store moves their secrets out at install", async () => {
    const { db, raw, secrets } = await setup();
    await db.upsertMcpServer(server("mcp_old"));

    await installMcpSecretStore(db, secrets, true);

    expect(JSON.stringify((await raw("mcp_old"))?.config)).not.toContain(TOKEN);
    expect((await db.getMcpServer("mcp_old"))?.config).toEqual(
      server("mcp_old").config
    );
  });

  test("deleting a server deletes its secret", async () => {
    const { db, secrets } = await setup();
    await installMcpSecretStore(db, secrets, true);
    await db.upsertMcpServer(server("mcp_gone"));

    await db.deleteMcpServer("mcp_gone");

    expect(await db.getManagedSecret("mcp", "mcp_gone")).toBeNull();
  });

  test("a grant larger than the 8 KiB secret default is still stored", async () => {
    const { db, secrets } = await setup();
    await installMcpSecretStore(db, secrets, true);
    const big = server("mcp_big");
    const jwt = "x".repeat(12_000);
    big.config = {
      headers: { Authorization: `Bearer ${TOKEN}` },
      oauth: { tokens: { access_token: jwt, token_type: "Bearer" } },
      url: "https://mcp.example.com/mcp",
    };

    await db.upsertMcpServer(big);

    expect((await db.getMcpServer("mcp_big"))?.config).toEqual(big.config);
  });
});
