import type { ToolDetail } from "@tinyclaw/core/contract";
import { BUILTIN_TOOL_IDS, isProtectedToolId } from "@tinyclaw/core/tools/protected";
import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmailSettingsDialog } from "@/components/EmailSettingsDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToolsQuery, useProfilesQuery } from "@/hooks/use-app-queries";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useAuth } from "@/context/auth-context";
import { useDeleteToolMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { findSuperBotProfile } from "@/lib/profiles";
import { queryKeys } from "@/lib/query-keys";
import { canUseToolPlayground, toolPlaygroundPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

function isDeletableTool(tool: ToolDetail): boolean {
  return !isProtectedToolId(tool.id);
}

export function ToolsTab() {
  const { navigateToNewChat } = useAppNavigation();
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canUsePlayground = canUseToolPlayground(
    user?.isPlatformAdmin === true,
    activeOrg?.role,
  );
  const queryClient = useQueryClient();
  const { data: tools = [], isLoading, error, isFetching } = useToolsQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const superBotProfile = findSuperBotProfile(profiles);
  const deleteToolMutation = useDeleteToolMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);

  const loading = isLoading && tools.length === 0;
  const refreshing = isFetching && !loading;
  const busy = deleteToolMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);
  const deletableCount = tools.filter(isDeletableTool).length;
  const playgroundToolCount = tools.filter(
    (tool) => tool.handlerType === "javascript" && isDeletableTool(tool),
  ).length;

  async function refresh() {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.tools.all });
  }

  function goToCreateTool() {
    if (!superBotProfile) {
      setActionError("No super bot profile exists in this organization.");
      return;
    }

    navigateToNewChat(superBotProfile.id);
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
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  if (loading) {
    return <PageState message="Loading tools…" />;
  }

  return (
    <>
      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {canUsePlayground && playgroundToolCount === 0 ? (
        <p
          className="mb-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
          role="status"
        >
          The Tools Playground lives at{" "}
          <code className="type-code">/system/playground/&lt;tool-id&gt;</code>. Create a custom
          JavaScript tool with Super Bot first — built-in tools like{" "}
          <code className="type-code">web_search</code> do not have a playground.
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
                      playgroundHref={
                        canUsePlayground && isDeletableTool(tool)
                          ? toolPlaygroundPath(tool.id)
                          : undefined
                      }
                      onDelete={() => void handleDeleteTool(tool.id, tool.name)}
                      onConfigure={
                        isOrgAdmin && tool.id === BUILTIN_TOOL_IDS.email
                          ? () => setEmailConfigOpen(true)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      {isOrgAdmin ? (
        <EmailSettingsDialog open={emailConfigOpen} onOpenChange={setEmailConfigOpen} />
      ) : null}
    </>
  );
}

function ToolListItem({
  tool,
  busy,
  playgroundHref,
  onDelete,
  onConfigure,
}: {
  tool: ToolDetail;
  busy: boolean;
  playgroundHref?: string;
  onDelete: () => void;
  onConfigure?: () => void;
}) {
  const deletable = isDeletableTool(tool);

  const summary = (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{tool.name}</p>
      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {tool.description}
      </p>
    </div>
  );

  return (
    <li className="group flex items-start justify-between gap-3 px-4 py-3 first:rounded-t-md last:rounded-b-md hover:bg-muted/40">
      {playgroundHref ? (
        <Link
          to={playgroundHref}
          aria-label={`Open playground for ${tool.name}`}
          className={cn(
            "min-w-0 flex-1 text-left",
            busy && "pointer-events-none opacity-50",
          )}
        >
          {summary}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{summary}</div>
      )}

      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
        {deletable ? (
          <span className="scope-badge bg-muted text-muted-foreground">custom tool</span>
        ) : (
          <span className="scope-badge scope-badge-active">built-in</span>
        )}

        {onConfigure ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onConfigure();
            }}
          >
            Configure
          </Button>
        ) : null}

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
            Delete
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
