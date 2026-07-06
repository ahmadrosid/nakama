import type { McpServerSummary } from "@nakama/core/contract";
import { PlusIcon } from "lucide-react";
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
  servers: McpServerSummary[];
  disabled?: boolean;
  buttonLabel?: string;
  onAssign: (serverId: string) => void | Promise<void>;
  className?: string;
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
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" aria-hidden />
        {buttonLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Choose an MCP server to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search MCP servers…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No MCP servers found.</CommandEmpty>
              <CommandGroup>
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
                    <div className="min-w-0">
                      <p>{server.name}</p>
                      <p className="text-xs text-muted-foreground">
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
