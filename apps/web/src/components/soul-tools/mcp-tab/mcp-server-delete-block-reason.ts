import type { McpServerSummary } from "@nakama/core/contract";
import { isPreinstalledMcpServerId } from "@nakama/core/mcp/preinstalled";

export function mcpServerDeleteBlockReason(
  server: McpServerSummary
): string | null {
  if (isPreinstalledMcpServerId(server.id)) {
    return "Preinstalled MCP servers cannot be deleted.";
  }

  return null;
}
