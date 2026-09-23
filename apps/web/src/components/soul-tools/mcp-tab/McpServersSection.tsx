import type { McpServerSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Loading03Icon as LoaderIcon,
  PencilIcon,
  Plug01Icon,
  RefreshIcon,
} from "hugeicons-react";
import { useId } from "react";
import { McpServerTools } from "@/components/soul-tools/mcp-tab/McpServerTools";
import { mcpServerDeleteBlockReason } from "@/components/soul-tools/mcp-tab/mcp-server-delete-block-reason";

export function McpPageState({
  message,
  embedded = false,
}: {
  message: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-6 text-muted-foreground text-sm",
        !embedded && "mx-auto max-w-3xl"
      )}
    >
      <Spinner className="size-4" />
      {message}
    </div>
  );
}

function McpServerActions({
  server,
  busy,
  syncing,
  onEdit,
  onConnect,
  onTestConnection,
  onSync,
  onDelete,
}: {
  server: McpServerSummary;
  busy: boolean;
  syncing: boolean;
  onEdit: () => void;
  onConnect: () => void;
  onTestConnection: () => void;
  onSync: () => void;
  onDelete: () => void;
}) {
  const deleteBlockReason = mcpServerDeleteBlockReason(server);
  const deleteReasonId = useId();

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1 [&_button]:min-h-8 pointer-coarse:[&_button]:min-h-11">
      {server.status === "connected" ? null : (
        <Button disabled={busy} onClick={onConnect} size="sm" type="button">
          <Plug01Icon aria-hidden />
          {server.status === "needs_auth" ? "Sign in" : "Connect"}
        </Button>
      )}
      <Button
        disabled={busy}
        onClick={onTestConnection}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plug01Icon aria-hidden />
        Test connection
      </Button>
      <Button
        disabled={busy}
        onClick={onEdit}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PencilIcon aria-hidden />
        Edit
      </Button>
      <Button
        aria-busy={syncing}
        disabled={busy}
        onClick={onSync}
        size="sm"
        type="button"
        variant="ghost"
      >
        {syncing ? (
          <LoaderIcon aria-hidden className="motion-safe:animate-spin" />
        ) : (
          <RefreshIcon aria-hidden />
        )}
        {syncing ? "Syncing…" : "Sync tools"}
      </Button>
      {deleteBlockReason ? (
        <Tooltip>
          <TooltipTrigger
            aria-describedby={deleteReasonId}
            render={
              <Button
                className="text-muted-foreground opacity-50"
                disabled
                focusableWhenDisabled
                size="sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <Delete02Icon aria-hidden />
            Delete
          </TooltipTrigger>
          <TooltipContent id={deleteReasonId} role="tooltip">
            {deleteBlockReason}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Delete02Icon aria-hidden />
          Delete
        </Button>
      )}
    </div>
  );
}

export function McpServersSection({
  servers,
  busy,
  syncingServerId = null,
  embedded = false,
  expandedServerId,
  onToggleServer,
  onAddServer,
  onEdit,
  onConnect,
  onTestConnection,
  onSync,
  onDelete,
}: {
  servers: McpServerSummary[];
  busy: boolean;
  syncingServerId?: string | null;
  embedded?: boolean;
  onAddServer: () => void;
  expandedServerId: string | null;
  onToggleServer: (serverId: string | null) => void;
  onEdit: (serverId: string) => void;
  onConnect: (serverId: string) => void;
  onTestConnection: (serverId: string) => void;
  onSync: (serverId: string) => void;
  onDelete: (server: McpServerSummary) => void;
}) {
  const orderedServers = [...servers].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  return (
    <section
      className={cn(
        "min-w-0 space-y-8",
        embedded ? "p-4" : "mx-auto max-w-3xl"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-normal text-sm">MCP servers</h2>
          <p className="type-body mt-1 text-xs">
            {servers.length === 0
              ? "No MCP servers registered yet"
              : `${servers.length} registered`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button onClick={onAddServer} size="sm" type="button">
            <Add01Icon aria-hidden className="size-4" />
            Add server
          </Button>
        </div>
      </div>

      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="p-0">
          {servers.length === 0 ? (
            <div className="p-6 text-muted-foreground text-sm">
              Register MCP servers here, then assign them to profiles on the
              Profiles page.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {orderedServers.map((server) => {
                const assignedProfileCount = server.assignedProfileCount ?? 0;

                return (
                  <li key={server.id}>
                    <button
                      aria-controls={`mcp-tools-${server.id}`}
                      aria-expanded={expandedServerId === server.id}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                      onClick={() =>
                        onToggleServer(
                          expandedServerId === server.id ? null : server.id
                        )
                      }
                      type="button"
                    >
                      <ArrowRight01Icon
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground",
                          expandedServerId === server.id && "rotate-90"
                        )}
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-all text-foreground text-sm">
                            {server.name}
                          </span>
                          {assignedProfileCount > 0 ? (
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                              {assignedProfileCount} profile
                              {assignedProfileCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {server.status === "needs_auth" ? (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-700 text-xs dark:text-amber-300">
                              Sign-in required
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-muted-foreground text-xs">
                          {server.toolCount} tool
                          {server.toolCount === 1 ? "" : "s"}
                          {server.status === "needs_auth"
                            ? ""
                            : ` · ${server.status === "connected" ? "Connected" : server.status === "error" ? "Error" : "Disconnected"}`}
                        </span>
                        {server.lastError ? (
                          <span className="block break-words text-destructive text-xs">
                            {server.lastError}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <div
                      hidden={expandedServerId !== server.id}
                      id={`mcp-tools-${server.id}`}
                    >
                      {expandedServerId === server.id ? (
                        <div className="space-y-3 border-border border-t bg-muted/10 p-4">
                          <McpServerActions
                            busy={busy}
                            onConnect={() => onConnect(server.id)}
                            onDelete={() => onDelete(server)}
                            onEdit={() => onEdit(server.id)}
                            onSync={() => onSync(server.id)}
                            onTestConnection={() => onTestConnection(server.id)}
                            server={server}
                            syncing={syncingServerId === server.id}
                          />
                          <McpServerTools server={server} />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
