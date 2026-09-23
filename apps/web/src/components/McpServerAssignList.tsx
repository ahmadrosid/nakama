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
import { cn } from "@nakama/ui/utils";
import { Plug01Icon, RefreshIcon } from "hugeicons-react";
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
      <CommandInput placeholder="Search MCP servers…" />
      {sync.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(sync.error)}
        </p>
      ) : null}
      <CommandList className="max-h-none min-h-0 flex-1 overflow-hidden rounded-md border border-border p-1">
        <CommandEmpty className="text-pretty">
          No MCP servers found.
        </CommandEmpty>
        <CommandGroup className="p-0">
          {servers.map((server) => (
            <CommandItem
              className="rounded-sm! py-2 [&>svg]:hidden"
              disabled={busy}
              key={server.id}
              onSelect={() => {
                onAssign(server.id);
              }}
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
                aria-busy={sync.isPending && sync.variables === server.id}
                aria-label={`Sync tools for ${server.name}`}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  sync.mutate(server.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                size="sm"
                type="button"
                variant="ghost"
              >
                <RefreshIcon
                  aria-hidden
                  className={cn(
                    "size-4",
                    sync.isPending &&
                      sync.variables === server.id &&
                      "motion-safe:animate-spin"
                  )}
                />
                {sync.isPending && sync.variables === server.id
                  ? "Syncing…"
                  : "Sync tools"}
              </Button>
              {onTestConnection ? (
                <Button
                  aria-label={`Test connection for ${server.name}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTestConnection(server);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Plug01Icon aria-hidden className="size-4" />
                </Button>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
