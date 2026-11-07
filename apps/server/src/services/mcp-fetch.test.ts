import { describe, expect, test } from "bun:test";
import { McpClientManager } from "./mcp-client-manager";
import { assertNotLinkLocal } from "./mcp-fetch";

describe("MCP remote fetch", () => {
  test("refuses link-local addresses, including the cloud metadata host", async () => {
    for (const host of [
      "169.254.169.254",
      "[fe80::1]",
      "::ffff:169.254.169.254",
    ]) {
      await expect(assertNotLinkLocal(host)).rejects.toThrow("link-local");
    }
  });

  test("keeps loopback and private hosts reachable", async () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "[::1]"]) {
      await expect(assertNotLinkLocal(host)).resolves.toBeUndefined();
    }
  });

  test("an HTTP MCP server on the metadata address is refused before any request", async () => {
    const manager = new McpClientManager();

    await expect(
      manager.ensureConnected(
        {
          cachedTools: [],
          config: { url: "http://169.254.169.254/mcp" },
          createdAt: "",
          enabled: true,
          id: "metadata",
          lastError: null,
          name: "metadata",
          status: "disconnected",
          transport: "http",
          updatedAt: "",
        },
        "org_1",
        "profile_1"
      )
    ).rejects.toThrow("link-local");

    await manager.disconnectAll();
  });
});
