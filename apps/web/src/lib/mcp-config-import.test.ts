import { describe, expect, test } from "bun:test";
import { parseMcpConfigJson } from "./mcp-config-import";

describe("parseMcpConfigJson", () => {
  test("parses Cursor-style mcpServers stdio config", () => {
    const result = parseMcpConfigJson(`{
      "mcpServers": {
        "youtube-transcript": {
          "command": "npx",
          "args": ["-y", "youtube-transcript-mcp"]
        }
      }
    }`);

    expect(result).toEqual({
      ok: true,
      importedCount: 1,
      server: {
        name: "youtube-transcript",
        transport: "stdio",
        config: {
          command: "npx",
          args: ["-y", "youtube-transcript-mcp"],
        },
      },
    });
  });

  test("parses HTTP server config", () => {
    const result = parseMcpConfigJson(`{
      "mcpServers": {
        "remote": {
          "url": "https://example.com/mcp",
          "headers": { "Authorization": "Bearer token" }
        }
      }
    }`);

    expect(result?.ok).toBe(true);

    if (!result || !result.ok) {
      throw new Error("Expected parsed HTTP config.");
    }

    expect(result.server).toEqual({
      name: "remote",
      transport: "http",
      config: {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  test("parses a bare server object without mcpServers wrapper", () => {
    const result = parseMcpConfigJson(`{
      "command": "npx",
      "args": ["-y", "pkg"]
    }`);

    expect(result?.ok).toBe(true);

    if (!result || !result.ok) {
      throw new Error("Expected parsed bare config.");
    }

    expect(result.server.name).toBe("mcp-server");
    expect(result.server.transport).toBe("stdio");
  });

  test("returns null for non-json paste", () => {
    expect(parseMcpConfigJson("npx -y pkg")).toBeNull();
  });

  test("returns an error for invalid JSON", () => {
    expect(parseMcpConfigJson("{not-json")).toEqual({
      ok: false,
      error: "Invalid JSON.",
    });
  });
});
