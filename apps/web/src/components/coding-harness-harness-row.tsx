import type { CodingHarnessStatus } from "@nakama/core/contract";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  CodingHarnessStatusChip,
} from "@/components/coding-harness-status-chip";

export function CodingHarnessHarnessRow({
  harness,
  selected,
  expanded,
  installingId,
  installProgress,
  onSelect,
  onToggleExpanded,
  onCopyInstallCommand,
  onInstall,
}: {
  harness: CodingHarnessStatus;
  selected: boolean;
  expanded: boolean;
  installingId: string | null;
  installProgress: string | null;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onCopyInstallCommand: (command: string) => void;
  onInstall: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-[color,background-color,border-color]",
        expanded && "divide-y",
        selected
          ? cn("border-primary/35 bg-primary/[0.06]", expanded && "divide-primary/25")
          : cn(
              "border-border bg-background hover:border-border/80 hover:bg-muted/20",
              expanded && "divide-border",
            ),
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <span className="min-w-0 flex-1 space-y-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{harness.name}</span>
              {harness.version ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {harness.version}
                </span>
              ) : null}
            </span>

            <span className="flex flex-wrap gap-1.5 text-xs">
              <CodingHarnessStatusChip
                variant={harness.installed ? "solid-ok" : "solid-warn"}
                label={harness.installed ? "Installed" : "Not installed"}
              />
              <CodingHarnessStatusChip
                variant={harness.ready ? "ok" : "muted"}
                label={harness.ready ? "Ready" : "Not ready yet"}
              />
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {selected ? (
            <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              Selected
            </span>
          ) : null}
          <button
            type="button"
            className="relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[color,background-color,transform] before:absolute before:-inset-1.5 before:content-[''] hover:bg-muted/60 hover:text-foreground active:scale-[0.96] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${harness.name}` : `Expand ${harness.name}`}
            onClick={onToggleExpanded}
          >
            <span className="relative inline-flex size-4 items-center justify-center">
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                  expanded ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0",
                )}
                aria-hidden
              />
              <ChevronUpIcon
                className={cn(
                  "absolute size-4 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                  expanded ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]",
                )}
                aria-hidden
              />
            </span>
          </button>
        </div>
      </div>

      {expanded ? (
        <div className={cn("px-4 py-3", selected ? "bg-primary/[0.04]" : "bg-muted/20")}>
          <p className="text-sm text-muted-foreground">
            {!harness.installed
              ? harness.installHint
              : (harness.statusMessage ?? "Run the readiness check to confirm provider passthrough.")}
          </p>

          {!harness.installed ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                  {harness.installCommand}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onCopyInstallCommand(harness.installCommand)}
                >
                  <CopyIcon className="size-3.5" />
                  Copy install
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onInstall}
                  disabled={installingId === harness.id}
                >
                  {installingId === harness.id ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <DownloadIcon className="size-3.5" />
                  )}
                  {installingId === harness.id ? "Installing…" : "Install"}
                </Button>
              </div>
              {installingId === harness.id && installProgress ? (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {installProgress}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
