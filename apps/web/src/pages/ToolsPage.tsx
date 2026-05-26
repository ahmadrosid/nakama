import type { ToolSummary } from "@tinyclaw/core/contract";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useToolsQuery } from "@/hooks/use-app-queries";
import { useDeleteToolMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

const sectionClass = "rounded-md border border-border bg-card p-4";

const PROTECTED_TOOL_IDS = new Set([
  "tool_write_file",
  "tool_delete_file",
  "tool_web_search",
  "tool_bash",
]);

function isDeletableTool(tool: ToolSummary): boolean {
  return !PROTECTED_TOOL_IDS.has(tool.id);
}

export function ToolsPage() {
  const { navigateToPage } = useAppNavigation();
  const queryClient = useQueryClient();
  const { data: tools = [], isLoading, error, isFetching } = useToolsQuery();
  const deleteToolMutation = useDeleteToolMutation();
  const [actionError, setActionError] = useState<string | null>(null);

  const loading = isLoading;
  const busy = deleteToolMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);

  async function handleDeleteTool(tool: ToolSummary) {
    if (!isDeletableTool(tool)) {
      return;
    }

    if (
      !window.confirm(
        `Delete tool "${tool.name}"? This removes it from every profile and cannot be undone.`,
      )
    ) {
      return;
    }

    setActionError(null);

    try {
      await deleteToolMutation.mutateAsync(tool.id);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div>
        <section className={cn(sectionClass, "p-5")}>
          <h2 className="type-section-title">Create via agent</h2>
          <p className="type-body mt-2">
            New tools are registered by <strong className="text-foreground">Super Bot</strong> in
            Chat using the <code className="rounded bg-muted px-1 py-0.5 type-code">create_tool</code>{" "}
            meta-tool.
          </p>

          <Button
            type="button"
            className="mt-5 w-full"
            onClick={() => navigateToPage("chat")}
          >
            Open Chat
          </Button>
        </section>
      </div>

      <section className="space-y-4">
        {errorMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        <div className={cn(sectionClass, "p-5")}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="type-section-title">All tools</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {loading ? "Loading…" : `${tools.length} registered`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || busy || isFetching}
              onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all })}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tools…</p>
          ) : tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tools yet. Ask Super Bot in Chat to create one.
            </p>
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <article
                  key={tool.id}
                  className="rounded-md border border-border bg-muted/30 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{tool.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-md border border-border bg-muted px-2.5 py-1 type-code text-muted-foreground">
                        {tool.handlerType}
                      </span>
                      {isDeletableTool(tool) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleDeleteTool(tool)}
                        >
                          <Trash2Icon />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="type-code mt-3 text-muted-foreground/80">{tool.id}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
