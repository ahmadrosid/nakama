import type { McpServerSummary } from "@nakama/core/contract";
import { isPreinstalledMcpServerId } from "@nakama/core/mcp/preinstalled";
import { useState } from "react";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import {
  McpPageState,
  McpServersSection,
} from "@/components/soul-tools/mcp-tab/McpServersSection";
import { McpServerToolsDialog } from "@/components/soul-tools/mcp-tab/McpServerToolsDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
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
  const [deleteTarget, setDeleteTarget] = useState<McpServerSummary | null>(
    null
  );
  const editServer =
    servers.find((server) => server.id === editServerId) ?? null;
  const detailServer =
    servers.find((server) => server.id === detailServerId) ?? null;

  const loading = isLoading && servers.length === 0;
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    connectMutation.isPending ||
    syncMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);

  function requestDelete(server: McpServerSummary) {
    if (
      isPreinstalledMcpServerId(server.id) ||
      (server.assignedProfileCount ?? 0) > 0
    ) {
      return;
    }

    setDeleteTarget(server);
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setActionError(null);

    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDetailServerId((current) =>
        current === deleteTarget.id ? null : current
      );
      setDeleteTarget(null);
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
    return <McpPageState embedded={embedded} message="Loading MCP servers…" />;
  }

  return (
    <>
      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}

      <McpServersSection
        busy={busy}
        embedded={embedded}
        onAddServer={() => setCreateOpen(true)}
        onConnect={(serverId) => void handleConnect(serverId)}
        onDelete={requestDelete}
        onEdit={setEditServerId}
        onSync={(serverId) => void handleSync(serverId)}
        onViewTools={setDetailServerId}
        servers={servers}
      />

      <McpServerToolsDialog
        onOpenChange={(open) => {
          if (!open) {
            setDetailServerId(null);
          }
        }}
        open={detailServerId !== null}
        server={detailServer}
      />

      <McpServerDialog
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
            const response = await createMutation.mutateAsync({
              ...request,
              connect: true,
            });
            setCreateOpen(false);
            setDetailServerId(response.server.id);
          } catch (err) {
            const message = formatError(err);
            setActionError(message);
            throw new Error(message);
          }
        }}
        open={createOpen}
      />

      <McpServerDialog
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
              request: updateRequest,
              serverId: editServer.id,
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
        open={editServerId !== null}
        server={editServer}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!(open || deleteMutation.isPending)) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete MCP server?</DialogTitle>
            <DialogDescription>
              Remove{" "}
              {deleteTarget?.name
                ? `"${deleteTarget.name}"`
                : "this MCP server"}
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              {deleteMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
