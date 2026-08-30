import type { McpServerSummary } from "@nakama/core/contract";
import { isPreinstalledMcpServerId } from "@nakama/core/mcp/preinstalled";

export function mcpServerDeleteBlockReason(
  server: McpServerSummary
): string | null {
  if (isPreinstalledMcpServerId(server.id)) {
    return "Preinstalled MCP servers cannot be deleted.";
  }

  const assignedProfileCount = server.assignedProfileCount ?? 0;

  if (assignedProfileCount === 1) {
    return "Assigned to 1 profile. Unassign on the Profiles page before deleting.";
  }

  if (assignedProfileCount > 1) {
    return `Assigned to ${assignedProfileCount} profiles. Unassign on the Profiles page before deleting.`;
  }

  return null;
}
