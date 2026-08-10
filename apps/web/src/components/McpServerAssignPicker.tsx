import type { McpServerSummary } from "@nakama/core/contract";
import { Add01Icon } from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface McpServerAssignPickerProps {
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  onAssign: (serverId: string) => void | Promise<void>;
  servers: McpServerSummary[];
}

export function McpServerAssignPicker({
  servers,
  disabled = false,
  buttonLabel = "Add MCP server",
  onAssign,
  className,
}: McpServerAssignPickerProps) {
  const [open, setOpen] = useState(false);

  if (servers.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        className={cn("w-full sm:w-auto", className)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Add01Icon aria-hidden className="size-4" />
        {buttonLabel}
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
        open={open}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-border border-b px-6 py-4 text-left">
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Choose an MCP server to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search MCP servers…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No MCP servers found.</CommandEmpty>
              <CommandGroup>
                {servers.map((server) => (
                  <CommandItem
                    disabled={disabled}
                    key={server.id}
                    onSelect={() => {
                      void onAssign(server.id);
                      setOpen(false);
                    }}
                    value={server.name}
                  >
                    <div className="min-w-0">
                      <p>{server.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {server.transport} · {server.toolCount} tool
                        {server.toolCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
