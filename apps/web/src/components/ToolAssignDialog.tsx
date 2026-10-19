import type { ToolSummary } from "@nakama/core/contract";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Add01Icon } from "hugeicons-react";
import { useState } from "react";
import { groupAssignableTools, isPluginOwned } from "@/hooks/use-plugins";

interface ToolAssignDialogProps {
  disabled?: boolean;
  error?: string | null;
  groupPlugins?: boolean;
  hideTrigger?: boolean;
  onAssign: (toolId: string) => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  tools: ToolSummary[];
}

export function ToolAssignDialog({
  tools,
  groupPlugins = false,
  disabled = false,
  error = null,
  hideTrigger = false,
  onAssign,
  onOpenChange,
  open: openProp,
}: ToolAssignDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;

  function setOpen(nextOpen: boolean) {
    onOpenChange?.(nextOpen);

    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen);
    }
  }

  // A plugin's handler expands one id to all its actions; the cloud browser
  // group has no handler of its own, so each of its tools is assigned in turn.
  async function assignGroup(tool: ToolSummary, members: ToolSummary[]) {
    const ids = tool.pluginId ? [tool.id] : members.map((entry) => entry.id);

    for (const id of ids) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- Assign in order and stop at the first failure.
      await onAssign(id);
    }
  }

  if (tools.length === 0 && !hideTrigger) {
    return null;
  }

  return (
    <>
      {hideTrigger ? null : (
        <Button
          disabled={disabled}
          onClick={() => setOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Add01Icon aria-hidden className="size-4" data-icon="inline-start" />
          Add tool
        </Button>
      )}

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
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search tools…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>
                {tools.length === 0
                  ? "All tools are already assigned."
                  : "No tools found."}
              </CommandEmpty>
              <CommandGroup>
                {(groupPlugins
                  ? groupAssignableTools(tools)
                  : tools.map((tool) => ({
                      label: tool.name,
                      tool,
                      tools: [tool],
                      unit: null,
                    }))
                ).map(({ label, tool, tools: members, unit }) => (
                  <CommandItem
                    disabled={disabled}
                    key={tool.id}
                    onSelect={() => {
                      setOpen(false);
                      void assignGroup(tool, members);
                    }}
                    value={`${label} ${tool.pluginId ?? ""} ${members.map((entry) => `${entry.name} ${entry.description}`).join(" ")}`}
                  >
                    <div className="min-w-0">
                      <p>{label}</p>
                      {unit ? (
                        <p className="truncate text-muted-foreground text-xs">
                          {members.length} {unit}
                        </p>
                      ) : isPluginOwned(tool) ? (
                        <p className="truncate text-muted-foreground text-xs">
                          {tool.pluginId}
                        </p>
                      ) : tool.description ? (
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
