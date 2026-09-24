import type { McpServerSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { cn } from "@nakama/ui/utils";
import {
  Loading03Icon as LoaderIcon,
  MoreHorizontalIcon,
} from "hugeicons-react";
import { useSyncMcpServerMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

export function McpServerAssignList({
  className,
  disabled = false,
  onAssign,
  onTestConnection,
  servers,
}: {
  className?: string;
  disabled?: boolean;
  onAssign: (serverId: string) => void;
  onTestConnection?: (server: McpServerSummary) => void;
  servers: McpServerSummary[];
}) {
  const sync = useSyncMcpServerMutation();
  const busy = disabled || sync.isPending;

  return (
    <Command
      className={cn(
        "gap-3 rounded-none! bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0",
        className
      )}
    >
      {servers.length > 5 ? (
        <CommandInput placeholder="Search MCP servers…" />
      ) : null}
      {sync.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(sync.error)}
        </p>
      ) : null}
      <CommandList className="max-h-72 min-h-0 overflow-y-auto rounded-md border border-border p-1">
        <CommandEmpty className="text-pretty">
          No MCP servers found.
        </CommandEmpty>
        <CommandGroup className="p-0">
          {servers.map((server) => (
            <CommandItem
              className="rounded-sm! py-2 [&>svg]:hidden"
              disabled={busy}
              key={server.id}
              value={server.name}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground text-sm leading-tight">
                  {server.name}
                </p>
                <p className="mt-0.5 text-pretty text-muted-foreground text-xs leading-snug">
                  {server.transport} · {server.toolCount} tool
                  {server.toolCount === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                aria-label={`Add ${server.name}`}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onAssign(server.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                size="sm"
                type="button"
              >
                Add
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-busy={sync.isPending && sync.variables === server.id}
                  disabled={busy}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  render={
                    <Button
                      aria-label={`More actions for ${server.name}`}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  {sync.isPending && sync.variables === server.id ? (
                    <LoaderIcon
                      aria-hidden
                      className="size-4 motion-safe:animate-spin"
                    />
                  ) : (
                    <MoreHorizontalIcon aria-hidden className="size-4" />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => sync.mutate(server.id)}>
                    Sync tools
                  </DropdownMenuItem>
                  {onTestConnection ? (
                    <DropdownMenuItem onClick={() => onTestConnection(server)}>
                      Test connection
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
