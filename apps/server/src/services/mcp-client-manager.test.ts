import { describe, expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StoredMcpServerRecord } from "@nakama/db";
import { McpClientManager } from "./mcp-client-manager";

function fakeStdioServer(id = "stdio-server"): StoredMcpServerRecord {
  return {
    cachedTools: [],
    config: { command: "fake-mcp" },
    createdAt: "",
    enabled: true,
    id,
    lastError: null,
    name: "fake",
    status: "disconnected",
    transport: "stdio",
    updatedAt: "",
  };
}

describe("McpClientManager", () => {
  test("concurrent ensureConnected shares one client", async () => {
    let releaseListTools!: () => void;
    const listToolsGate = new Promise<void>((resolve) => {
      releaseListTools = resolve;
    });
    let clientConnectCount = 0;
    let listToolsCount = 0;
    let closeCount = 0;

    using _connect = spyOn(Client.prototype, "connect").mockImplementation(
      async () => {
        clientConnectCount += 1;
      }
    );
    using _listTools = spyOn(Client.prototype, "listTools").mockImplementation(
      async () => {
        listToolsCount += 1;
        await listToolsGate;
        return {
          tools: [{ description: "Demo", inputSchema: {}, name: "demo_tool" }],
        };
      }
    );
    using _close = spyOn(
      StdioClientTransport.prototype,
      "close"
    ).mockImplementation(async () => {
      closeCount += 1;
    });

    const manager = new McpClientManager();
    const server = fakeStdioServer();
    const orgId = "org_1";
    const profileId = "profile_1";

    const first = manager.ensureConnected(server, orgId, profileId);
    const second = manager.ensureConnected(server, orgId, profileId);

    for (let i = 0; i < 50 && listToolsCount === 0; i += 1) {
      await Bun.sleep(1);
    }
    expect(listToolsCount).toBe(1);
    expect(clientConnectCount).toBe(1);

    releaseListTools();
    await Promise.all([first, second]);

    expect(manager.getConnectedCount()).toBe(1);
    expect(clientConnectCount).toBe(1);
    expect(listToolsCount).toBe(1);

    await manager.disconnectAll();
    expect(manager.getConnectedCount()).toBe(0);
    expect(closeCount).toBe(1);
  });

  test("concurrent ensureConnected failures leave no map entry", async () => {
    let releaseListTools!: () => void;
    const listToolsGate = new Promise<void>((resolve) => {
      releaseListTools = resolve;
    });
    let listToolsCount = 0;

    using _connect = spyOn(Client.prototype, "connect").mockResolvedValue(
      undefined
    );
    using _listTools = spyOn(Client.prototype, "listTools").mockImplementation(
      async () => {
        listToolsCount += 1;
        await listToolsGate;
        throw new Error("list tools failed");
      }
    );

    const manager = new McpClientManager();
    const server = fakeStdioServer("stdio-fail");
    const orgId = "org_1";
    const profileId = "profile_1";

    const first = manager.ensureConnected(server, orgId, profileId);
    const second = manager.ensureConnected(server, orgId, profileId);

    for (let i = 0; i < 50 && listToolsCount === 0; i += 1) {
      await Bun.sleep(1);
    }
    expect(listToolsCount).toBe(1);

    releaseListTools();
    const results = await Promise.allSettled([first, second]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(manager.getConnectedCount()).toBe(0);
    expect(listToolsCount).toBe(1);
  });
});
