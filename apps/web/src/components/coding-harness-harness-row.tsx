import type { CodingHarnessStatus } from "@nakama/core/contract";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  CodingHarnessStatusChip,
  type CodingHarnessStatusChipVariant,
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
        "overflow-hidden rounded-lg border transition-colors",
        expanded && "divide-y",
        selected
          ? cn("border-primary/35 bg-primary/[0.06]", expanded && "divide-primary/25")
          : cn("border-border bg-background", expanded && "divide-border"),
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <span className="min-w-0 flex-1 space-y-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{harness.name}</span>
              {harness.version ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
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
                variant={authVariant(harness)}
                label={authLabel(harness)}
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
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${harness.name}` : `Expand ${harness.name}`}
            onClick={onToggleExpanded}
          >
            {expanded ? (
              <ChevronUpIcon className="size-4" aria-hidden />
            ) : (
              <ChevronDownIcon className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className={cn("px-4 py-3", selected ? "bg-primary/[0.04]" : "bg-muted/20")}>
          <p className="text-sm text-muted-foreground">
            {!harness.installed
              ? harness.installHint
              : (harness.statusMessage ?? "Run the readiness check to confirm login.")}
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

function authVariant(harness: CodingHarnessStatus): CodingHarnessStatusChipVariant {
  if (!harness.installed) {
    return "muted";
  }

  if (harness.authenticated === true) {
    return "ok";
  }

  if (harness.authenticated === false) {
    return "solid-warn";
  }

  return "muted";
}

function authLabel(harness: CodingHarnessStatus): string {
  if (!harness.installed) {
    return "Waiting for install";
  }

  if (harness.authenticated === true) {
    return "Logged in";
  }

  if (harness.authenticated === false) {
    return "Needs login";
  }

  return "Login not checked";
}
