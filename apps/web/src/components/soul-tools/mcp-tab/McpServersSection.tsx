import type { McpServerSummary } from "@nakama/core/contract";
import { isPreinstalledMcpServerId } from "@nakama/core/mcp/preinstalled";
import {
  EllipsisVerticalIcon,
  EyeIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { sectionClass } from "@/components/soul-tools/mcp-tab/shared";
import { McpToolLabels } from "@/components/soul-tools/McpToolList";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
        "flex items-center gap-2 p-6 text-sm text-muted-foreground",
        !embedded && "rounded-md border border-border bg-card",
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
  onViewTools,
  onEdit,
  onConnect,
  onSync,
  onDelete,
}: {
  server: McpServerSummary;
  busy: boolean;
  onViewTools: () => void;
  onEdit: () => void;
  onConnect: () => void;
  onSync: () => void;
  onDelete: () => void;
}) {
  const assignedProfileCount = server.assignedProfileCount ?? 0;
  const preinstalled = isPreinstalledMcpServerId(server.id);
  const deleteBlocked = preinstalled || assignedProfileCount > 0;
  const deleteTooltip = preinstalled
    ? "Preinstalled MCP servers cannot be deleted."
    : assignedProfileCount === 1
      ? "Assigned to 1 profile. Unassign on the Profiles page before deleting."
      : `Assigned to ${assignedProfileCount} profiles. Unassign on the Profiles page before deleting.`;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`View tools for ${server.name}`}
        onClick={onViewTools}
      >
        <EyeIcon className="size-4" aria-hidden />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Actions for ${server.name}`}
            />
          }
        >
          <EllipsisVerticalIcon className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {server.status !== "connected" ? (
            <DropdownMenuItem disabled={busy} onClick={onConnect}>
              <PlugIcon aria-hidden />
              Connect
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={busy} onClick={onEdit}>
            <PencilIcon aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={onSync}>
            <RefreshCwIcon aria-hidden />
            Sync tools
          </DropdownMenuItem>
          {deleteBlocked ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuItem variant="destructive" disabled>
                    <Trash2Icon aria-hidden />
                    Delete
                  </DropdownMenuItem>
                }
              />
              <TooltipContent side="left">{deleteTooltip}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function McpServersSection({
  servers,
  busy,
  embedded = false,
  onAddServer,
  onViewTools,
  onEdit,
  onConnect,
  onSync,
  onDelete,
}: {
  servers: McpServerSummary[];
  busy: boolean;
  embedded?: boolean;
  onAddServer: () => void;
  onViewTools: (serverId: string) => void;
  onEdit: (serverId: string) => void;
  onConnect: (serverId: string) => void;
  onSync: (serverId: string) => void;
  onDelete: (server: McpServerSummary) => void;
}) {
  return (
    <section className={cn(!embedded && sectionClass, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="type-section-title">MCP servers</h2>
          <p className="type-body mt-1 text-xs">
            {servers.length === 0
              ? "No MCP servers registered yet"
              : `${servers.length} registered`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" onClick={onAddServer}>
            <PlusIcon className="size-4" aria-hidden />
            Add server
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          Register MCP servers here, then assign them to profiles on the Profiles page.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {servers.map((server) => {
            const assignedProfileCount = server.assignedProfileCount ?? 0;

            return (
            <li key={server.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{server.name}</p>
                    {assignedProfileCount > 0 ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {assignedProfileCount} profile
                              {assignedProfileCount === 1 ? "" : "s"}
                            </span>
                          }
                        />
                        <TooltipContent side="top">
                          Assigned to {assignedProfileCount} profile
                          {assignedProfileCount === 1 ? "" : "s"}. Unassign on the Profiles page
                          before deleting.
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                  {server.lastError ? (
                    <p className="mt-1 text-xs text-destructive">{server.lastError}</p>
                  ) : null}
                  <McpToolLabels
                    serverId={server.id}
                    toolCount={server.toolCount}
                    connected={server.status === "connected"}
                    onShowAll={() => onViewTools(server.id)}
                  />
                </div>

                <McpServerActions
                  server={server}
                  busy={busy}
                  onViewTools={() => onViewTools(server.id)}
                  onEdit={() => onEdit(server.id)}
                  onConnect={() => onConnect(server.id)}
                  onSync={() => onSync(server.id)}
                  onDelete={() => onDelete(server)}
                />
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
