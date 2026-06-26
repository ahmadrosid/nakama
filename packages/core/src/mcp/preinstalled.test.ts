import { describe, expect, test } from "bun:test";
import {
  isPreinstalledMcpServerId,
  PREINSTALLED_MCP_SERVER_IDS,
  preinstalledMcpServers,
} from "./preinstalled";

describe("preinstalled MCP servers", () => {
  test("registers exa and currency-conversion with stable ids", () => {
    expect(preinstalledMcpServers.map((server) => server.name)).toEqual([
      "exa",
      "currency-conversion",
    ]);
    expect(preinstalledMcpServers[0]?.config).toEqual({ url: "https://mcp.exa.ai/mcp" });
    expect(preinstalledMcpServers[1]?.config).toEqual({
      url: "https://currency-mcp.wesbos.com/mcp",
    });
  });

  test("isPreinstalledMcpServerId recognizes seeded ids", () => {
    expect(isPreinstalledMcpServerId(PREINSTALLED_MCP_SERVER_IDS.exa)).toBe(true);
    expect(isPreinstalledMcpServerId(PREINSTALLED_MCP_SERVER_IDS.currency_conversion)).toBe(true);
    expect(isPreinstalledMcpServerId("mcp_custom")).toBe(false);
  });
});
