import type { McpHttpConfig, McpStdioConfig, McpTransport } from "../contract";

export const PREINSTALLED_MCP_SERVER_IDS = {
  exa: "mcp_exa",
  currency_conversion: "mcp_currency_conversion",
} as const;

export type PreinstalledMcpServerDefinition = {
  id: string;
  name: string;
  transport: McpTransport;
  config: McpHttpConfig | McpStdioConfig;
};

export const preinstalledMcpServers: PreinstalledMcpServerDefinition[] = [
  {
    id: PREINSTALLED_MCP_SERVER_IDS.exa,
    name: "exa",
    transport: "http",
    config: {
      url: "https://mcp.exa.ai/mcp",
    },
  },
  {
    id: PREINSTALLED_MCP_SERVER_IDS.currency_conversion,
    name: "currency-conversion",
    transport: "http",
    config: {
      url: "https://currency-mcp.wesbos.com/mcp",
    },
  },
];

export const PREINSTALLED_MCP_SERVER_ID_SET = new Set<string>(
  Object.values(PREINSTALLED_MCP_SERVER_IDS),
);

export function isPreinstalledMcpServerId(serverId: string): boolean {
  return PREINSTALLED_MCP_SERVER_ID_SET.has(serverId);
}
