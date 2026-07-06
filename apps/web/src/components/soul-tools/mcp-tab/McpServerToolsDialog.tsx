import type { McpServerSummary } from "@nakama/core/contract";
import { BlocksIcon } from "lucide-react";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: McpServerSummary["status"] }) {
  const label =
    status === "connected" ? "Connected" : status === "error" ? "Error" : "Disconnected";

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        status === "connected" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "error" && "bg-destructive/10 text-destructive",
        status === "disconnected" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function McpServerToolsDialog({
  server,
  open,
  onOpenChange,
}: {
  server: McpServerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: detail, isLoading, error } = useMcpServerDetailQuery(
    open && server ? server.id : null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85dvh,42rem)] max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        {server ? (
          <>
            <DialogHeader className="gap-2 pr-8 sm:gap-3">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground"
                  aria-hidden
                >
                  <BlocksIcon className="size-4" />
                </span>
                {server.name}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Tools exposed by this MCP server and available to assigned profiles.
              </DialogDescription>
              {detail?.transport === "stdio" && "command" in detail.config ? (
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={detail.config.command}
                >
                  {detail.config.command}
                  {detail.config.args?.length ? ` ${detail.config.args.join(" ")}` : ""}
                </p>
              ) : detail?.transport === "http" && "url" in detail.config ? (
                <p className="truncate font-mono text-xs text-muted-foreground" title={detail.config.url}>
                  {detail.config.url}
                </p>
              ) : isLoading ? (
                <p className="text-xs text-muted-foreground">Loading server details…</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusBadge status={server.status} />
                <span className="text-xs text-muted-foreground">
                  {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
                </span>
              </div>
            </DialogHeader>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {isLoading && !detail ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Loading tools…
                </div>
              ) : error ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  {formatError(error)}
                </p>
              ) : !detail || detail.cachedTools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {server.status === "connected"
                    ? "Connected, but no tools were discovered. Try Sync tools from the server menu."
                    : "No cached tools yet. Connect and sync this server."}
                </p>
              ) : (
                <McpToolList tools={detail.cachedTools} />
              )}
            </div>

            <DialogFooter className="mx-0 mb-0 shrink-0 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
