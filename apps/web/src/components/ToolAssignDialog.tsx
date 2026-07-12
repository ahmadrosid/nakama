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
  tools: ToolSummary[];
  disabled?: boolean;
  onAssign: (toolId: string) => void | Promise<void>;
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
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" aria-hidden />
        Add tool
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Add tool</DialogTitle>
            <DialogDescription>
              Choose a tool to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search tools…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No tools found.</CommandEmpty>
              <CommandGroup>
                {tools.map((tool) => (
                  <CommandItem
                    key={tool.id}
                    value={`${tool.name} ${tool.description}`}
                    disabled={disabled}
                    onSelect={() => {
                      void onAssign(tool.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0">
                      <p>{tool.name}</p>
                      {tool.description ? (
                        <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
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
