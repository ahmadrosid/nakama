import type { ToolSummary } from "@nakama/core/contract";
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

interface ToolAssignDialogProps {
  disabled?: boolean;
  onAssign: (toolId: string) => void | Promise<void>;
  tools: ToolSummary[];
}

export function ToolAssignDialog({
  tools,
  disabled = false,
  onAssign,
}: ToolAssignDialogProps) {
  const [open, setOpen] = useState(false);

  if (tools.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon aria-hidden className="size-4" data-icon="inline-start" />
        Add tool
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
        open={open}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-border border-b px-6 py-4 text-left">
            <DialogTitle>Add tool</DialogTitle>
            <DialogDescription>
              Choose a tool to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search tools…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No tools found.</CommandEmpty>
              <CommandGroup>
                {tools.map((tool) => (
                  <CommandItem
                    disabled={disabled}
                    key={tool.id}
                    onSelect={() => {
                      void onAssign(tool.id);
                      setOpen(false);
                    }}
                    value={`${tool.name} ${tool.description}`}
                  >
                    <div className="min-w-0">
                      <p>{tool.name}</p>
                      {tool.description ? (
                        <p className="truncate text-muted-foreground text-xs">
                          {tool.description}
                        </p>
                      ) : null}
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
