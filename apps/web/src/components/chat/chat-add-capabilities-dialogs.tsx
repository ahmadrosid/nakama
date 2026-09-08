import type { CreateMcpServerRequest } from "@nakama/core/contract";
import { useState } from "react";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import {
  useMcpServersQuery,
  useProfileQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  useAssignMcpServerMutation,
  useAssignToolMutation,
  useCreateMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

export function ChatAddCapabilitiesDialogs({
  mcpOpen,
  onMcpOpenChange,
  onToolOpenChange,
  profileId,
  toolOpen,
}: {
  mcpOpen: boolean;
  onMcpOpenChange: (open: boolean) => void;
  onToolOpenChange: (open: boolean) => void;
  profileId: string;
  toolOpen: boolean;
}) {
  const { data: tools = [] } = useToolsQuery();
  const { data: servers = [] } = useMcpServersQuery();
  const { data: profile } = useProfileQuery(profileId);
  const assignToolMutation = useAssignToolMutation();
  const assignMcpMutation = useAssignMcpServerMutation();
  const createMcpMutation = useCreateMcpServerMutation();
  const [error, setError] = useState<string | null>(null);

  const assignedToolIds = new Set(profile?.tools.map((tool) => tool.id) ?? []);
  const assignedMcpIds = new Set(
    profile?.mcpServers.map((server) => server.id) ?? []
  );
  const availableTools = tools.filter((tool) => !assignedToolIds.has(tool.id));
  const availableMcpServers = servers.filter(
    (server) => !assignedMcpIds.has(server.id)
  );
  const busy =
    assignToolMutation.isPending ||
    assignMcpMutation.isPending ||
    createMcpMutation.isPending;

  async function handleAssignTool(toolId: string) {
    setError(null);

    try {
      await assignToolMutation.mutateAsync({ profileId, toolId });
      onToolOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAssignMcp(serverId: string) {
    setError(null);

    try {
      await assignMcpMutation.mutateAsync({ profileId, serverId });
      onMcpOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleCreateMcp(request: CreateMcpServerRequest) {
    setError(null);

    try {
      const response = await createMcpMutation.mutateAsync({
        ...request,
        connect: true,
      });
      await assignMcpMutation.mutateAsync({
        profileId,
        serverId: response.server.id,
      });
      onMcpOpenChange(false);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw new Error(message);
    }
  }

  return (
    <>
      <ToolAssignDialog
        disabled={busy}
        error={toolOpen ? error : null}
        hideTrigger
        onAssign={handleAssignTool}
        onOpenChange={(open) => {
          if (!open) {
            setError(null);
          }
          onToolOpenChange(open);
        }}
        open={toolOpen}
        tools={availableTools}
      />
      <McpServerDialog
        availableServers={availableMcpServers}
        busy={busy}
        error={mcpOpen ? error : null}
        onAssign={handleAssignMcp}
        onOpenChange={(open) => {
          if (!open) {
            setError(null);
          }
          onMcpOpenChange(open);
        }}
        onSubmit={handleCreateMcp}
        open={mcpOpen}
      />
    </>
  );
}
