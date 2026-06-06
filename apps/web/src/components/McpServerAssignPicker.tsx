import type { McpServerSummary } from "@tinyclaw/core/contract";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface McpServerAssignPickerProps {
  servers: McpServerSummary[];
  disabled?: boolean;
  onAssign: (serverId: string) => void | Promise<void>;
  className?: string;
}

export function McpServerAssignPicker({
  servers,
  disabled = false,
  onAssign,
  className,
}: McpServerAssignPickerProps) {
  const [open, setOpen] = useState(false);

  if (servers.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={cn("w-full gap-1.5 sm:w-auto", className)}
            aria-label="Assign MCP server"
          />
        }
      >
        Assign MCP server…
        <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={4} className="w-56 overflow-hidden p-0">
        <Command className="rounded-lg bg-transparent p-0">
          <CommandList className="max-h-56 p-1">
            <CommandEmpty className="py-4 text-sm">No servers available.</CommandEmpty>
            <CommandGroup className="p-1">
              {servers.map((server) => (
                <CommandItem
                  key={server.id}
                  value={server.name}
                  disabled={disabled}
                  onSelect={() => {
                    void onAssign(server.id);
                    setOpen(false);
                  }}
                >
                  {server.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
