import type { McpServerSummary, ProfileDetail } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  Delete02Icon,
  Loading03Icon as LoaderIcon,
  McpServerIcon,
  RefreshIcon,
} from "hugeicons-react";
import { useState } from "react";
import { McpServerAuthorizeDialog } from "@/components/soul-tools/mcp-tab/McpServerAuthorizeDialog";
import { useConnectMcpServerMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";

export function ProfileMcpSection({
  detail,
  busy,
  allMcpServers,
  onAssign,
  onCreateOpen,
  onRemove,
}: {
  detail: ProfileDetail;
  busy: boolean;
  allMcpServers: McpServerSummary[];
  onAssign: (serverId: string) => void;
  onCreateOpen: () => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
}) {
  const queryClient = useQueryClient();
  const connectMutation = useConnectMcpServerMutation();

  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const [pendingAuth, setPendingAuth] = useState<{
    name: string;
    url: string;
  } | null>(null);

  async function handleReconnect(serverId: string) {
    setReconnectError(null);
    setReconnectingId(serverId);

    try {
      const response = await connectMutation.mutateAsync(serverId);

      if (response.authorizationUrl) {
        setPendingAuth({
          name: response.server.name,
          url: response.authorizationUrl,
        });
      }
    } catch (err) {
      setReconnectError(formatError(err));
    } finally {
      setReconnectingId(null);
    }
  }

  if (detail.mcpServers.length === 0) {
    return (
      <div className="flex flex-col gap-7 pt-5">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border border-dashed px-6 py-8">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <McpServerIcon aria-hidden className="size-6 text-foreground/80" />
          </div>
          <h3 className="font-semibold text-base text-foreground">
            No MCP servers
          </h3>
          <Button disabled={busy} onClick={onCreateOpen} type="button">
            <Add01Icon aria-hidden className="size-4" />
            Add MCP server
          </Button>
        </div>

        {allMcpServers.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h4 className="font-medium text-muted-foreground text-xs">
              Or reuse one from this organization
            </h4>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {allMcpServers.map((server) => (
                <li
                  className="flex items-center justify-between gap-2 px-4 py-3"
                  key={server.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground text-sm leading-tight">
                      {server.name}
                    </p>
                    <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                      {server.transport} · {server.toolCount} tool
                      {server.toolCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    aria-label={`Add ${server.name}`}
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => onAssign(server.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-normal text-muted-foreground/55 text-sm">
            MCP servers
          </h3>
          <p className="type-body mt-1 text-xs">
            {detail.mcpServers.length} assigned
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={onCreateOpen}
          size="sm"
          type="button"
          variant="outline"
        >
          <Add01Icon aria-hidden className="size-4" />
          Add MCP server
        </Button>
      </div>

      {reconnectError ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {reconnectError}
        </p>
      ) : null}

      <McpServerAuthorizeDialog
        authorizationUrl={pendingAuth?.url ?? null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingAuth(null);
            void queryClient.invalidateQueries({
              queryKey: queryKeys.profiles.all,
            });
          }
        }}
        open={pendingAuth !== null}
        serverName={pendingAuth?.name ?? ""}
      />

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {detail.mcpServers.map((server) => (
          <li
            className="flex items-center justify-between gap-2 px-4 py-3"
            key={server.id}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground text-sm leading-tight">
                {server.name}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                {server.transport} · {server.toolCount} tool
                {server.toolCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-busy={reconnectingId === server.id}
                aria-label={`Reconnect ${server.name}`}
                className="text-muted-foreground"
                disabled={busy || reconnectingId !== null}
                onClick={() => void handleReconnect(server.id)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {reconnectingId === server.id ? (
                  <LoaderIcon
                    aria-hidden
                    className="size-4 motion-safe:animate-spin"
                  />
                ) : (
                  <RefreshIcon aria-hidden className="size-4" />
                )}
              </Button>
              <Button
                aria-label={`Delete ${server.name}`}
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  onRemove({ id: server.id, kind: "mcp", name: server.name })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Delete02Icon aria-hidden className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
