import type { CreateMcpServerRequest } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useState } from "react";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { useAuth } from "@/context/use-auth";
import {
  useMcpServersQuery,
  useProfileQuery,
  useSkillsQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  pluginAgentAccessState,
  useOrgPlugins,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import {
  useAssignMcpServerMutation,
  useAssignToolMutation,
  useCreateMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

export function ChatAddCapabilitiesDialogs({
  pluginOpen,
  onPluginOpenChange,
  mcpOpen,
  onMcpOpenChange,
  onToolOpenChange,
  profileId,
  toolOpen,
}: {
  pluginOpen: boolean;
  onPluginOpenChange(open: boolean): void;
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
      {pluginOpen ? (
        <ChatPluginDialog
          onOpenChange={onPluginOpenChange}
          profileId={profileId}
        />
      ) : null}
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

function ChatPluginDialog({
  profileId,
  onOpenChange,
}: {
  profileId: string;
  onOpenChange(open: boolean): void;
}) {
  const { user } = useAuth();
  const plugins = useOrgPlugins();
  const profile = useProfileQuery(profileId);
  const tools = useToolsQuery();
  const skills = useSkillsQuery();
  const save = useSavePluginAgentAccess();
  if (!user?.isPlatformAdmin) {
    return null;
  }
  const loading =
    plugins.isLoading ||
    profile.isLoading ||
    tools.isLoading ||
    skills.isLoading;
  const error =
    save.error || plugins.error || profile.error || tools.error || skills.error;
  const enabled = (plugins.data ?? []).filter(
    (plugin) => plugin.installed && plugin.lifecycleState === "enabled"
  );
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!save.isPending) {
          onOpenChange(open);
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add plugin</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(error)}
          </p>
        ) : null}
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading plugins…</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-auto">
            {enabled.map((plugin) => {
              const assigned =
                profile.data &&
                pluginAgentAccessState(profile.data, plugin.pluginId, {
                  skills: skills.data ?? [],
                  tools: tools.data ?? [],
                });
              return (
                <li
                  className="flex items-center justify-between gap-3 py-3"
                  key={plugin.pluginId}
                >
                  <span className="font-medium text-sm">{plugin.name}</span>
                  <Button
                    disabled={
                      !assigned ||
                      assigned.full ||
                      assigned.total === 0 ||
                      save.isPending
                    }
                    onClick={() =>
                      save.mutate({
                        changes: { [profileId]: true },
                        pluginId: plugin.pluginId,
                      })
                    }
                    size="sm"
                  >
                    {assigned?.full ? "Enabled" : "Enable"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && enabled.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No enabled plugins available.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
