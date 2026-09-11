import type { McpServerSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { CubeIcon } from "hugeicons-react";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

function McpServerEndpointMeta({
  detail,
  isLoading,
}: {
  detail: ReturnType<typeof useMcpServerDetailQuery>["data"];
  isLoading: boolean;
}) {
  if (detail?.transport === "stdio" && "command" in detail.config) {
    return (
      <p
        className="truncate font-mono text-muted-foreground text-xs"
        title={detail.config.command}
      >
        {detail.config.command}
        {detail.config.args?.length ? ` ${detail.config.args.join(" ")}` : ""}
      </p>
    );
  }

  if (detail?.transport === "http" && "url" in detail.config) {
    return (
      <p
        className="truncate font-mono text-muted-foreground text-xs"
        title={detail.config.url}
      >
        {detail.config.url}
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="text-muted-foreground text-xs">Loading server details…</p>
    );
  }

  return null;
}

function McpServerToolsContent({
  isLoading,
  detail,
  error,
  server,
}: {
  isLoading: boolean;
  detail: ReturnType<typeof useMcpServerDetailQuery>["data"];
  error: unknown;
  server: McpServerSummary;
}) {
  if (isLoading && !detail) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        Loading tools…
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm">
        {formatError(error)}
      </p>
    );
  }

  if (!detail || detail.cachedTools.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {server.status === "connected"
          ? "Connected, but no tools were discovered. Try Sync tools from the server menu."
          : "No cached tools yet. Connect and sync this server."}
      </p>
    );
  }

  return <McpToolList tools={detail.cachedTools} />;
}

function McpServerToolsDialogBody({
  server,
  detail,
  isLoading,
  error,
  onOpenChange,
}: {
  server: McpServerSummary;
  detail: ReturnType<typeof useMcpServerDetailQuery>["data"];
  isLoading: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <DialogHeader className="gap-2 pr-8 sm:gap-3">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground"
          >
            <CubeIcon className="size-4" />
          </span>
          {server.name}
        </DialogTitle>
        <DialogDescription className="leading-relaxed">
          Tools exposed by this MCP server and available to assigned profiles.
        </DialogDescription>
        <McpServerEndpointMeta detail={detail} isLoading={isLoading} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge status={server.status} />
          <span className="text-muted-foreground text-xs">
            {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
          </span>
        </div>
      </DialogHeader>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <McpServerToolsContent
          detail={detail}
          error={error}
          isLoading={isLoading}
          server={server}
        />
      </div>

      <DialogFooter className="mx-0 mb-0 shrink-0 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function StatusBadge({ status }: { status: McpServerSummary["status"] }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Error"
        : "Disconnected";

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        status === "connected" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "error" && "bg-destructive/10 text-destructive",
        status === "disconnected" && "bg-muted text-muted-foreground"
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
  const {
    data: detail,
    isLoading,
    error,
  } = useMcpServerDetailQuery(open && server ? server.id : null);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(85dvh,42rem)] max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        {server ? (
          <McpServerToolsDialogBody
            detail={detail}
            error={error}
            isLoading={isLoading}
            onOpenChange={onOpenChange}
            server={server}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
