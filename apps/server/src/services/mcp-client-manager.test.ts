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
  test("invalid stored configuration cannot start a client", async () => {
    let connections = 0;

    using _connect = spyOn(Client.prototype, "connect").mockImplementation(
      async () => {
        connections += 1;
      }
    );

    const manager = new McpClientManager();

    const cases: Array<Pick<StoredMcpServerRecord, "config" | "transport">> = [
      { config: null, transport: "stdio" },
      { config: { command: 7 }, transport: "stdio" },
      { config: { args: [7], command: "fake-mcp" }, transport: "stdio" },
      {
        config: { command: "fake-mcp", env: { TOKEN: 7 } },
        transport: "stdio",
      },
      { config: { url: 7 }, transport: "http" },
      {
        config: { headers: { Authorization: 7 }, url: "https://example.com" },
        transport: "http",
      },
    ];

    for (const input of cases) {
      await expect(
        manager.connect({ ...fakeStdioServer(), ...input })
      ).rejects.toThrow();
    }

    expect(connections).toBe(0);
    expect(manager.getConnectedCount()).toBe(0);
  });

  test("forgets a connection when its transport closes", async () => {
    const clients: Client[] = [];

    using _connect = spyOn(Client.prototype, "connect").mockImplementation(
      async function (this: Client) {
        clients.push(this);
      }
    );

    using _listTools = spyOn(Client.prototype, "listTools").mockResolvedValue({
      tools: [],
    });

    using _close = spyOn(
      StdioClientTransport.prototype,
      "close"
    ).mockResolvedValue(undefined);

    const manager = new McpClientManager();
    const server = fakeStdioServer();

    await manager.ensureConnected(server, "org_1", "profile_1");
    expect(manager.isConnected(server.id, "stdio", "profile_1", "org_1")).toBe(
      true
    );

    clients[0]?.onclose?.();

    expect(manager.isConnected(server.id, "stdio", "profile_1", "org_1")).toBe(
      false
    );

    await manager.ensureConnected(server, "org_1", "profile_1");
    expect(clients).toHaveLength(2);
    expect(manager.getConnectedCount()).toBe(1);
    await manager.disconnectAll();
  });

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
          tools: [
            {
              description: "Demo",
              inputSchema: { type: "object" as const },
              name: "demo_tool",
            },
          ],
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

  test("ensureConnected reconnects after disconnect following a shared connect", async () => {
    let releaseListTools!: () => void;

    const listToolsGate = new Promise<void>((resolve) => {
      releaseListTools = resolve;
    });

    let clientConnectCount = 0;

    using _connect = spyOn(Client.prototype, "connect").mockImplementation(
      async () => {
        clientConnectCount += 1;
      }
    );

    using _listTools = spyOn(Client.prototype, "listTools").mockImplementation(
      async () => {
        await listToolsGate;

        return {
          tools: [
            {
              description: "Demo",
              inputSchema: { type: "object" as const },
              name: "demo_tool",
            },
          ],
        };
      }
    );

    using _close = spyOn(
      StdioClientTransport.prototype,
      "close"
    ).mockImplementation(async () => undefined);

    const manager = new McpClientManager();
    const server = fakeStdioServer("stdio-reconnect");
    const orgId = "org_1";
    const profileId = "profile_1";

    const shared = Promise.all([
      manager.ensureConnected(server, orgId, profileId),
      manager.ensureConnected(server, orgId, profileId),
    ]);

    releaseListTools();
    await shared;
    expect(manager.getConnectedCount()).toBe(1);
    expect(clientConnectCount).toBe(1);

    await manager.disconnect(server.id);
    expect(manager.getConnectedCount()).toBe(0);

    await manager.ensureConnected(server, orgId, profileId);
    expect(manager.getConnectedCount()).toBe(1);
    expect(clientConnectCount).toBe(2);
  });

  test("tool images leave the text and fit the model limit", async () => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64"
    );

    const screenshot = await new Bun.Image(pixel)
      .resize(3000, 1000)
      .png()
      .toBase64();

    using _connect = spyOn(Client.prototype, "connect").mockResolvedValue(
      undefined
    );

    using _listTools = spyOn(Client.prototype, "listTools").mockResolvedValue({
      tools: [],
    });

    using _callTool = spyOn(Client.prototype, "callTool").mockResolvedValue({
      content: [
        { data: screenshot, mimeType: "image/png", type: "image" },
        { text: "Captured", type: "text" },
      ],
    });

    using _close = spyOn(
      StdioClientTransport.prototype,
      "close"
    ).mockResolvedValue(undefined);

    const manager = new McpClientManager();
    const server = fakeStdioServer("stdio-image");
    await manager.ensureConnected(server, "org_1", "profile_1");

    const result = await manager.callTool(
      server.id,
      "stdio",
      "screenshot",
      {},
      "profile_1",
      "org_1"
    );

    await manager.disconnectAll();

    // SAFETY: the result shape is asserted field by field below.
    const { content, images, text } = result as {
      content: Array<{ data?: string; type: string }>;
      images: Array<{ data: string; mediaType: string }>;
      text: string;
    };

    expect(JSON.stringify({ content, text })).not.toContain(
      screenshot.slice(0, 64)
    );
    expect(content.some((part) => part.type === "image" && !part.data)).toBe(
      true
    );
    expect(images).toHaveLength(1);

    const fitted = await new Bun.Image(
      Buffer.from(images[0]?.data ?? "", "base64")
    ).metadata();

    expect({ height: fitted.height, width: fitted.width }).toEqual({
      height: 667,
      width: 2000,
    });

    expect(text).toContain("Captured");
  });
});
