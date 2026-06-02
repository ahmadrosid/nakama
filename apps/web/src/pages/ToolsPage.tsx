import type { ToolDetail } from "@tinyclaw/core/contract";
import { isProtectedToolId } from "@tinyclaw/core/tools/protected";
import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ToolDetailDialog } from "@/components/tools/ToolDetailDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToolsQuery } from "@/hooks/use-app-queries";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useDeleteToolMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { NAV_ITEM_ICONS } from "@/lib/navigation";
import { SUPER_BOT_PROFILE_ID } from "@/lib/profiles";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

const ToolsIcon = NAV_ITEM_ICONS.tools;

function isDeletableTool(tool: ToolDetail): boolean {
  return !isProtectedToolId(tool.id);
}

export function ToolsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const queryClient = useQueryClient();
  const { data: tools = [], isLoading, error, isFetching } = useToolsQuery();
  const deleteToolMutation = useDeleteToolMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailToolId, setDetailToolId] = useState<string | null>(null);

  const loading = isLoading && tools.length === 0;
  const refreshing = isFetching && !loading;
  const busy = deleteToolMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);
  const deletableCount = tools.filter(isDeletableTool).length;

  async function refresh() {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.tools.all });
  }

  function goToCreateTool() {
    navigateToNewChat(SUPER_BOT_PROFILE_ID);
  }

  async function handleDeleteTool(toolId: string, toolName: string) {
    if (isProtectedToolId(toolId)) {
      return;
    }

    if (
      !window.confirm(
        `Delete tool "${toolName}"? This removes it from every profile and cannot be undone.`,
      )
    ) {
      return;
    }

    setActionError(null);

    try {
      await deleteToolMutation.mutateAsync(toolId);
      setDetailToolId(null);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  if (loading) {
    return <PageState message="Loading tools…" />;
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <section className={cn(sectionClass, "overflow-hidden")}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:hidden">
          <div className="min-w-0 flex-1">
            <h2 className="type-section-title">All tools</h2>
            <p className="type-body mt-1 text-xs">
              {tools.length === 0
                ? "No tools registered yet"
                : `${tools.length} registered · ${deletableCount} custom`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy || refreshing}
              aria-label="Refresh tools"
              onClick={() => void refresh()}
            >
              {refreshing ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCwIcon className="size-4" aria-hidden />
              )}
            </Button>
            <Button type="button" size="sm" onClick={goToCreateTool}>
              <PlusIcon className="size-4" aria-hidden />
              Create tool
            </Button>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
            <div className="mb-4">
              <h2 className="type-section-title">Tools</h2>
              <p className="type-body mt-1 text-xs">
                Registered capabilities the agent can call. Assign them per profile on the
                Profiles page.
              </p>
            </div>

            <button type="button" onClick={goToCreateTool} className="scope-item">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
                  <PlusIcon className="size-4 text-muted-foreground" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-foreground">Create tool</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Opens a new Super Bot chat session
                  </p>
                </div>
              </div>
            </button>

            <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs dark:bg-muted/30">
              <p className="font-medium text-foreground">How it works</p>
              <p className="mt-2">
                New tools are registered by <strong className="text-foreground">Super Bot</strong> in
                Chat using the{" "}
                <code className="rounded bg-muted px-1 py-0.5 type-code">create_tool</code>{" "}
                meta-tool. Built-in tools cannot be deleted.
              </p>
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="type-section-title">All tools</h2>
                <p className="type-body mt-1 text-xs">
                  {tools.length === 0
                    ? "No tools registered yet"
                    : `${tools.length} registered · ${deletableCount} custom`}
                </p>
              </div>

              <div className="hidden shrink-0 items-center gap-2 lg:flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || refreshing}
                  onClick={() => void refresh()}
                >
                  {refreshing ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RefreshCwIcon className="size-4" aria-hidden />
                  )}
                  Refresh
                </Button>
                <Button type="button" size="sm" onClick={goToCreateTool}>
                  Create tool
                </Button>
              </div>
            </div>

            {tools.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <p>No tools yet. Ask Super Bot to create one.</p>
                <Button type="button" size="sm" onClick={goToCreateTool}>
                  Create tool
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-4 text-xs text-muted-foreground lg:hidden">
                  Built-in tools are protected; custom tools can be removed.
                </p>

                <ul className="divide-y divide-border rounded-md border border-border">
                  {tools.map((tool) => (
                    <ToolListItem
                      key={tool.id}
                      tool={tool}
                      busy={busy}
                      onView={() => setDetailToolId(tool.id)}
                      onDelete={() => void handleDeleteTool(tool.id, tool.name)}
                    />
                  ))}
                </ul>
              </>
            )}

            <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
              <p className="font-medium text-foreground">How it works</p>
              <p className="mt-2">
                New tools are registered by <strong className="text-foreground">Super Bot</strong> in
                Chat using the{" "}
                <code className="rounded bg-muted px-1 py-0.5 type-code">create_tool</code>{" "}
                meta-tool. Assign tools to profiles from the Profiles page.
              </p>
            </div>
          </div>
        </div>
      </section>

      <ToolDetailDialog
        toolId={detailToolId}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setDetailToolId(null);
          }
        }}
        onDelete={(toolId, toolName) => void handleDeleteTool(toolId, toolName)}
      />
    </div>
  );
}

function ToolListItem({
  tool,
  busy,
  onView,
  onDelete,
}: {
  tool: ToolDetail;
  busy: boolean;
  onView: () => void;
  onDelete: () => void;
}) {
  const deletable = isDeletableTool(tool);

  return (
    <li className="group flex items-start justify-between gap-3 px-4 py-3 first:rounded-t-md last:rounded-b-md hover:bg-muted/40">
      <button
        type="button"
        disabled={busy}
        className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:opacity-50"
        aria-label={`View details for ${tool.name}`}
        onClick={onView}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30",
            deletable ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-300",
          )}
        >
          <ToolsIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{tool.name}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
          <p className="type-code mt-2 truncate text-muted-foreground/80" title={tool.id}>
            {tool.id}
          </p>
        </div>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
        <span
          className={cn(
            "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
            deletable
              ? "bg-muted text-muted-foreground"
              : "scope-badge scope-badge-active",
          )}
        >
          {deletable ? tool.handlerType : "built-in"}
        </span>

        {deletable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="text-muted-foreground hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon className="size-4" aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div
      className={cn(
        sectionClass,
        "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
