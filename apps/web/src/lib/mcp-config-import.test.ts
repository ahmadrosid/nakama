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
      importedCount: 1,
      ok: true,
      server: {
        config: {
          args: ["-y", "youtube-transcript-mcp"],
          command: "npx",
        },
        name: "youtube-transcript",
        transport: "stdio",
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

    if (!(result && result.ok)) {
      throw new Error("Expected parsed HTTP config.");
    }

    expect(result.server).toEqual({
      config: {
        headers: { Authorization: "Bearer token" },
        url: "https://example.com/mcp",
      },
      name: "remote",
      transport: "http",
    });
  });

  test("parses a bare server object without mcpServers wrapper", () => {
    const result = parseMcpConfigJson(`{
      "command": "npx",
      "args": ["-y", "pkg"]
    }`);

    expect(result?.ok).toBe(true);

    if (!(result && result.ok)) {
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
      error: "Invalid JSON.",
      ok: false,
    });
  });
});
