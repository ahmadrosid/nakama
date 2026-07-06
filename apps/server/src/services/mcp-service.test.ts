import { describe, expect, test } from "bun:test";
import { nanoid } from "@nakama/core";
import { PREINSTALLED_MCP_SERVER_IDS } from "@nakama/core/mcp/preinstalled";
import { createInMemoryDatabaseAdapter, ensurePreinstalledMcpServers } from "@nakama/db";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";

async function seedProfile(db: ReturnType<typeof createInMemoryDatabaseAdapter>) {
  const now = new Date().toISOString();
  const profile = {
    id: nanoid(),
    name: "Test Bot",
    systemPrompt: "You are helpful.",
    model: null,
    isSuper: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  return profile.id;
}

describe("McpService", () => {
  test("creates and lists MCP servers", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await service.createServer({
      name: "demo",
      transport: "http",
      config: { url: "https://example.com/mcp" },
      connect: false,
    });

    const listed = await service.listServers();

    expect(listed.servers).toHaveLength(1);
    expect(listed.servers[0]?.name).toBe("demo");
    expect(listed.servers[0]?.toolCount).toBe(0);
  });

  test("assigns MCP servers to profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "demo",
      transport: "http",
      config: { url: "https://example.com/mcp" },
      connect: false,
    });

    const profileId = await seedProfile(db);

    await service.assignServerToProfile(profileId, created.server.id);

    const assigned = await db.listMcpServersForProfile(profileId);

    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.id).toBe(created.server.id);
  });

  test("updates MCP server config while preserving blank header values", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "demo",
      transport: "http",
      config: {
        url: "https://example.com/mcp",
        headers: {
          Authorization: "secret-token",
          "X-Custom": "keep-me",
        },
      },
      connect: false,
    });

    const updated = await service.updateServer(created.server.id, {
      config: {
        url: "https://example.com/mcp",
        headers: {
          Authorization: "",
          "X-Custom": "updated-value",
        },
      },
    });

    const stored = await db.getMcpServer(created.server.id);

    expect(updated.server.config.headers).toEqual({
      Authorization: "••••••••",
      "X-Custom": "••••••••",
    });
    expect(stored?.config).toEqual({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "secret-token",
        "X-Custom": "updated-value",
      },
    });
  });

  test("creates and lists stdio MCP servers", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await service.createServer({
      name: "filesystem",
      transport: "stdio",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
      connect: false,
    });

    const listed = await service.listServers();

    expect(listed.servers).toHaveLength(1);
    expect(listed.servers[0]?.name).toBe("filesystem");
    expect(listed.servers[0]?.transport).toBe("stdio");
  });

  test("rejects stdio MCP servers without command", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await expect(
      service.createServer({
        name: "broken",
        transport: "stdio",
        config: { command: "" },
        connect: false,
      }),
    ).rejects.toThrow("stdio MCP servers require config.command.");
  });

  test("updates stdio MCP server config while preserving blank env values", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "filesystem",
      transport: "stdio",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: {
          API_KEY: "secret-token",
          NODE_ENV: "production",
        },
      },
      connect: false,
    });

    const updated = await service.updateServer(created.server.id, {
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: {
          API_KEY: "",
          NODE_ENV: "development",
        },
      },
    });

    const stored = await db.getMcpServer(created.server.id);

    expect(updated.server.config).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: {
        API_KEY: "••••••••",
        NODE_ENV: "••••••••",
      },
    });
    expect(stored?.config).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: {
        API_KEY: "secret-token",
        NODE_ENV: "development",
      },
    });
  });

  test("accepts command as an alias for stdio transport", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await service.createServer({
      name: "filesystem",
      transport: "command" as "stdio",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
      connect: false,
    });

    const listed = await service.listServers();

    expect(listed.servers[0]?.transport).toBe("stdio");
  });

  test("rejects stdio config when transport is http", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await expect(
      service.createServer({
        name: "broken",
        transport: "http",
        config: { command: "npx" },
        connect: false,
      }),
    ).rejects.toThrow("HTTP MCP servers require config.url.");
  });

  test("rejects HTTP config when transport is stdio", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await expect(
      service.createServer({
        name: "broken",
        transport: "stdio",
        config: { url: "https://example.com/mcp" },
        connect: false,
      }),
    ).rejects.toThrow("stdio MCP servers require config.command.");
  });

  test("blocks delete when MCP server is assigned to a profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "demo",
      transport: "http",
      config: { url: "https://example.com/mcp" },
      connect: false,
    });

    const profileId = await seedProfile(db);
    await service.assignServerToProfile(profileId, created.server.id);

    await expect(service.deleteServer(created.server.id)).rejects.toMatchObject({
      status: 409,
      profiles: [{ id: profileId, name: "Test Bot" }],
    });

    expect(await db.getMcpServer(created.server.id)).not.toBeNull();
  });

  test("deletes MCP server when not assigned to any profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "demo",
      transport: "http",
      config: { url: "https://example.com/mcp" },
      connect: false,
    });

    await service.deleteServer(created.server.id);

    expect(await db.getMcpServer(created.server.id)).toBeNull();
  });

  test("blocks delete for preinstalled MCP servers", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    await ensurePreinstalledMcpServers(db);

    await expect(service.deleteServer(PREINSTALLED_MCP_SERVER_IDS.exa)).rejects.toThrow(
      'Preinstalled MCP server "exa" cannot be deleted.',
    );

    expect(await db.getMcpServer(PREINSTALLED_MCP_SERVER_IDS.exa)).not.toBeNull();
  });

  test("lists assigned profile counts on MCP servers", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      name: "demo",
      transport: "http",
      config: { url: "https://example.com/mcp" },
      connect: false,
    });

    const profileId = await seedProfile(db);
    await service.assignServerToProfile(profileId, created.server.id);

    const listed = await service.listServers();

    expect(listed.servers[0]?.assignedProfileCount).toBe(1);
  });
});
