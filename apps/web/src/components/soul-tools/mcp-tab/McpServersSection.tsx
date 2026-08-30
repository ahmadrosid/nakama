import type { McpServerSummary } from "@nakama/core/contract";
import {
  Add01Icon,
  Delete02Icon,
  EyeIcon,
  MoreVerticalIcon,
  PencilIcon,
  Plug01Icon,
  RefreshIcon,
} from "hugeicons-react";
import { McpToolLabels } from "@/components/soul-tools/McpToolList";
import { mcpServerDeleteBlockReason } from "@/components/soul-tools/mcp-tab/mcp-server-delete-block-reason";
import { sectionClass } from "@/components/soul-tools/mcp-tab/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
        "flex items-center gap-2 p-6 text-muted-foreground text-sm",
        !embedded && "rounded-md border border-border bg-card"
      )}
    >
      <Spinner className="size-4" />
      {message}
    </div>
  );
}

function McpServerDeleteButton({
  server,
  busy,
  onDelete,
}: {
  server: McpServerSummary;
  busy: boolean;
  onDelete: () => void;
}) {
  const deleteBlockReason = mcpServerDeleteBlockReason(server);
  const label = `Delete ${server.name}`;

  if (deleteBlockReason) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              disabled
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Delete02Icon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="left">{deleteBlockReason}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      aria-label={label}
      disabled={busy}
      onClick={onDelete}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Delete02Icon aria-hidden className="size-4" />
    </Button>
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
  const deleteBlockReason = mcpServerDeleteBlockReason(server);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        aria-label={`View tools for ${server.name}`}
        onClick={onViewTools}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <EyeIcon aria-hidden className="size-4" />
      </Button>

      <McpServerDeleteButton busy={busy} onDelete={onDelete} server={server} />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${server.name}`}
              disabled={busy}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <MoreVerticalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {server.status === "connected" ? null : (
            <DropdownMenuItem disabled={busy} onClick={onConnect}>
              <Plug01Icon aria-hidden />
              Connect
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={busy} onClick={onEdit}>
            <PencilIcon aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={onSync}>
            <RefreshIcon aria-hidden />
            Sync tools
          </DropdownMenuItem>
          {deleteBlockReason ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuItem disabled variant="destructive">
                    <Delete02Icon aria-hidden />
                    Delete
                  </DropdownMenuItem>
                }
              />
              <TooltipContent side="left">{deleteBlockReason}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem
              disabled={busy}
              onClick={onDelete}
              variant="destructive"
            >
              <Delete02Icon aria-hidden />
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
      <div className="flex flex-wrap items-center gap-3 border-border border-b p-4">
        <div className="min-w-0 flex-1">
          <h2 className="type-section-title">MCP servers</h2>
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

      {servers.length === 0 ? (
        <div className="p-6 text-muted-foreground text-sm">
          Register MCP servers here, then assign them to profiles on the
          Profiles page.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {servers.map((server) => {
            const assignedProfileCount = server.assignedProfileCount ?? 0;

            return (
              <li className="p-4" key={server.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground text-sm">
                        {server.name}
                      </p>
                      {assignedProfileCount > 0 ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                                {assignedProfileCount} profile
                                {assignedProfileCount === 1 ? "" : "s"}
                              </span>
                            }
                          />
                          <TooltipContent side="top">
                            Assigned to {assignedProfileCount} profile
                            {assignedProfileCount === 1 ? "" : "s"}. Unassign on
                            the Profiles page before deleting.
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                    {server.lastError ? (
                      <p className="mt-1 text-destructive text-xs">
                        {server.lastError}
                      </p>
                    ) : null}
                    <McpToolLabels
                      connected={server.status === "connected"}
                      onShowAll={() => onViewTools(server.id)}
                      serverId={server.id}
                      toolCount={server.toolCount}
                    />
                  </div>

                  <McpServerActions
                    busy={busy}
                    onConnect={() => onConnect(server.id)}
                    onDelete={() => onDelete(server)}
                    onEdit={() => onEdit(server.id)}
                    onSync={() => onSync(server.id)}
                    onViewTools={() => onViewTools(server.id)}
                    server={server}
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
