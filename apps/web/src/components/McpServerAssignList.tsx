import type { McpServerSummary } from "@nakama/core/contract";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function McpServerAssignList({
  className,
  disabled = false,
  onAssign,
  servers,
}: {
  className?: string;
  disabled?: boolean;
  onAssign: (serverId: string) => void;
  servers: McpServerSummary[];
}) {
  return (
    <Command
      className={cn(
        "gap-3 rounded-none! bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0",
        className
      )}
    >
      <CommandInput placeholder="Search MCP servers…" />
      <CommandList className="max-h-none min-h-0 flex-1 overflow-hidden rounded-md border border-border p-1">
        <CommandEmpty className="text-pretty">
          No MCP servers found.
        </CommandEmpty>
        <CommandGroup className="p-0">
          {servers.map((server) => (
            <CommandItem
              className="rounded-sm! py-2 [&>svg]:hidden"
              disabled={disabled}
              key={server.id}
              onSelect={() => {
                onAssign(server.id);
              }}
              value={server.name}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm leading-tight">
                  {server.name}
                </p>
                <p className="mt-0.5 text-pretty text-muted-foreground text-xs leading-snug">
                  {server.transport} · {server.toolCount} tool
                  {server.toolCount === 1 ? "" : "s"}
                </p>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
