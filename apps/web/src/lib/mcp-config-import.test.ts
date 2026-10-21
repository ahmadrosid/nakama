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

  test("returns an error when mcpServers is empty", () => {
    const result = parseMcpConfigJson(`{ "mcpServers": {} }`);

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
  });

  test("parses OpenCode remote and local servers", () => {
    const remote = parseMcpConfigJson(`{
      "$schema": "https://opencode.ai/config.json",
      "mcp": {
        "nakama-owner": {
          "type": "remote",
          "url": "https://withnakama.com/mcp/owner",
          "enabled": true,
          "headers": { "Authorization": "Bearer token" }
        }
      }
    }`);

    expect(remote).toEqual({
      importedCount: 1,
      ok: true,
      server: {
        config: {
          headers: { Authorization: "Bearer token" },
          url: "https://withnakama.com/mcp/owner",
        },
        name: "nakama-owner",
        transport: "http",
      },
    });

    const local = parseMcpConfigJson(`{
      "mcp": {
        "files": {
          "type": "local",
          "command": ["npx", "-y", "pkg"],
          "environment": { "KEY": "v" }
        }
      }
    }`);

    expect(local).toEqual({
      importedCount: 1,
      ok: true,
      server: {
        config: { args: ["-y", "pkg"], command: "npx", env: { KEY: "v" } },
        name: "files",
        transport: "stdio",
      },
    });
  });
});
