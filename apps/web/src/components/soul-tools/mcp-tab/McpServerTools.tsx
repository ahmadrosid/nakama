import type { McpServerSummary } from "@nakama/core/contract";
import { Spinner } from "@nakama/ui/spinner";
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
          ? "Connected, but no tools were discovered. Try Sync tools."
          : "No cached tools yet. Connect and sync this server."}
      </p>
    );
  }

  return <McpToolList tools={detail.cachedTools} />;
}

export function McpServerTools({ server }: { server: McpServerSummary }) {
  const { data: detail, isLoading, error } = useMcpServerDetailQuery(server.id);

  return (
    <div className="space-y-3">
      <McpServerEndpointMeta detail={detail} isLoading={isLoading} />
      <McpServerToolsContent
        detail={detail}
        error={error}
        isLoading={isLoading}
        server={server}
      />
    </div>
  );
}
