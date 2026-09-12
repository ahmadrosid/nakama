import { describe, expect, test } from "bun:test";
import { mcpServerKind } from "./use-mcp-server-dialog-state";

describe("mcpServerKind", () => {
  test("splits an HTTP server by how it authenticates", () => {
    expect(mcpServerKind("http", false)).toBe("http");
    expect(mcpServerKind("http", true)).toBe("signin");
  });

  test("a command server is a command server, sign-in flag or not", () => {
    expect(mcpServerKind("stdio", false)).toBe("stdio");
    expect(mcpServerKind("stdio", true)).toBe("stdio");
  });
});
