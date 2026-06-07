import { describe, expect, test } from "bun:test";
import { createId } from "@tinyclaw/core";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";

async function seedProfile(db: ReturnType<typeof createInMemoryDatabaseAdapter>) {
  const now = new Date().toISOString();
  const profile = {
    id: createId("profile"),
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

  test("deleting a server removes profile assignments", async () => {
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
    await service.deleteServer(created.server.id);

    const assigned = await db.listMcpServersForProfile(profileId);

    expect(assigned).toHaveLength(0);
  });
});
