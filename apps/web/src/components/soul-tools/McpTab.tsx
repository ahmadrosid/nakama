import type { McpServerSummary } from "@nakama/core/contract";
import { useState } from "react";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { McpPageState, McpServersSection } from "@/components/soul-tools/mcp-tab/McpServersSection";
import { McpServerToolsDialog } from "@/components/soul-tools/mcp-tab/McpServerToolsDialog";
import { useMcpServersQuery } from "@/hooks/use-app-queries";
import {
  useConnectMcpServerMutation,
  useCreateMcpServerMutation,
  useDeleteMcpServerMutation,
  useSyncMcpServerMutation,
  useUpdateMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

export function McpTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: servers = [], isLoading, error } = useMcpServersQuery();
  const createMutation = useCreateMcpServerMutation();
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const connectMutation = useConnectMcpServerMutation();
  const syncMutation = useSyncMcpServerMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editServerId, setEditServerId] = useState<string | null>(null);
  const [detailServerId, setDetailServerId] = useState<string | null>(null);
  const editServer = servers.find((server) => server.id === editServerId) ?? null;
  const detailServer = servers.find((server) => server.id === detailServerId) ?? null;

  const loading = isLoading && servers.length === 0;
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    connectMutation.isPending ||
    syncMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);

  async function handleDelete(server: McpServerSummary) {
    if ((server.assignedProfileCount ?? 0) > 0) {
      return;
    }

    if (!window.confirm(`Delete MCP server "${server.name}"? This cannot be undone.`)) {
      return;
    }

    setActionError(null);

    try {
      await deleteMutation.mutateAsync(server.id);
      setDetailServerId((current) => (current === server.id ? null : current));
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function handleConnect(serverId: string) {
    setActionError(null);

    try {
      await connectMutation.mutateAsync(serverId);
      setDetailServerId(serverId);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function handleSync(serverId: string) {
    setActionError(null);

    try {
      await syncMutation.mutateAsync(serverId);
      setDetailServerId(serverId);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  if (loading) {
    return <McpPageState message="Loading MCP servers…" embedded={embedded} />;
  }

  return (
    <>
      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <McpServersSection
        servers={servers}
        busy={busy}
        embedded={embedded}
        onAddServer={() => setCreateOpen(true)}
        onViewTools={setDetailServerId}
        onEdit={setEditServerId}
        onConnect={(serverId) => void handleConnect(serverId)}
        onSync={(serverId) => void handleSync(serverId)}
        onDelete={(server) => void handleDelete(server)}
      />

      <McpServerToolsDialog
        server={detailServer}
        open={detailServerId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailServerId(null);
          }
        }}
      />

      <McpServerDialog
        open={createOpen}
        busy={createMutation.isPending}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setActionError(null);
          }
        }}
        onSubmit={async (request) => {
          setActionError(null);

          try {
            const response = await createMutation.mutateAsync({ ...request, connect: true });
            setCreateOpen(false);
            setDetailServerId(response.server.id);
          } catch (err) {
            const message = formatError(err);
            setActionError(message);
            throw new Error(message);
          }
        }}
      />

      <McpServerDialog
        server={editServer}
        open={editServerId !== null}
        busy={updateMutation.isPending || connectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setEditServerId(null);
            setActionError(null);
          }
        }}
        onSubmit={async (request) => {
          if (!editServer) {
            return;
          }

          setActionError(null);

          try {
            const wasConnected = editServer.status === "connected";
            const { connect: _connect, ...updateRequest } = request;
            await updateMutation.mutateAsync({
              serverId: editServer.id,
              request: updateRequest,
            });
            setEditServerId(null);

            if (wasConnected) {
              await connectMutation.mutateAsync(editServer.id);
            }
          } catch (err) {
            const message = formatError(err);
            setActionError(message);
            throw new Error(message);
          }
        }}
      />
    </>
  );
}
