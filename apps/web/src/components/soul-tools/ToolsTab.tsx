import type { ToolDetail } from "@nakama/core/contract";
import {
  BUILTIN_TOOL_IDS,
  isProtectedToolId,
} from "@nakama/core/tools/protected";
import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmailSettingsDialog } from "@/components/EmailSettingsDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery, useToolsQuery } from "@/hooks/use-app-queries";
import { useDeleteToolMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { canUseToolPlayground, toolPlaygroundPath } from "@/lib/navigation";
import { findSuperBotProfile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";
const toolSearchThreshold = 4;

function isDeletableTool(tool: ToolDetail): boolean {
  return !isProtectedToolId(tool.id);
}

export function ToolsTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { navigateToNewChat } = useAppNavigation();
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canUsePlayground = canUseToolPlayground(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );
  const { data: tools = [], isLoading, error } = useToolsQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const superBotProfile = findSuperBotProfile(profiles);
  const deleteToolMutation = useDeleteToolMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loading = isLoading && tools.length === 0;
  const busy = deleteToolMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);
  const customTools = tools.filter(isDeletableTool);
  const builtinTools = tools.filter((tool) => !isDeletableTool(tool));

  function goToCreateTool() {
    if (!superBotProfile) {
      setActionError("No super bot profile exists in this organization.");
      return;
    }

    navigateToNewChat(superBotProfile.id);
  }

  function requestDeleteTool(toolId: string, toolName: string) {
    if (isProtectedToolId(toolId)) {
      return;
    }

    setDeleteTarget({ id: toolId, name: toolName });
  }

  async function confirmDeleteTool() {
    if (!deleteTarget || isProtectedToolId(deleteTarget.id)) {
      return;
    }

    setActionError(null);

    try {
      await deleteToolMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  if (loading) {
    return <PageState embedded={embedded} message="Loading tools…" />;
  }

  const content = (
    <div className="min-w-0 p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="type-section-title text-balance">All tools</h2>
          <p className="type-body mt-1 text-pretty text-xs tabular-nums">
            {tools.length === 0
              ? "No tools registered yet"
              : `${tools.length} registered · ${customTools.length} custom · ${builtinTools.length} built-in`}
          </p>
        </div>

        <Button onClick={goToCreateTool} size="sm" type="button">
          <PlusIcon aria-hidden className="size-4" data-icon="inline-start" />
          Create tool
        </Button>
      </div>

      {tools.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-muted-foreground text-sm">
          <p>No tools yet. Ask Super Bot to create one.</p>
          <Button onClick={goToCreateTool} size="sm" type="button">
            <PlusIcon aria-hidden className="size-4" data-icon="inline-start" />
            Create tool
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <ToolListSection
            busy={busy}
            canUsePlayground={canUsePlayground}
            isOrgAdmin={isOrgAdmin}
            onConfigureEmail={() => setEmailConfigOpen(true)}
            onCreateTool={goToCreateTool}
            onDelete={requestDeleteTool}
            title="Custom tools"
            tools={customTools}
          />

          <ToolListSection
            busy={busy}
            canUsePlayground={canUsePlayground}
            isOrgAdmin={isOrgAdmin}
            onConfigureEmail={() => setEmailConfigOpen(true)}
            onDelete={requestDeleteTool}
            title="Built-in tools"
            tools={builtinTools}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="space-y-4">
        {errorMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {errorMessage}
          </p>
        ) : null}

        {embedded ? (
          content
        ) : (
          <section className={cn(sectionClass, "overflow-hidden")}>
            {content}
          </section>
        )}
      </div>

      {isOrgAdmin ? (
        <EmailSettingsDialog
          onOpenChange={setEmailConfigOpen}
          open={emailConfigOpen}
        />
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete tool?</DialogTitle>
            <DialogDescription>
              Remove{" "}
              {deleteTarget?.name ? `"${deleteTarget.name}"` : "this tool"} from
              every profile it is assigned to.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void confirmDeleteTool()}
              type="button"
              variant="destructive"
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolListSection({
  title,
  tools,
  busy,
  canUsePlayground,
  isOrgAdmin,
  onCreateTool,
  onDelete,
  onConfigureEmail,
}: {
  title: string;
  tools: ToolDetail[];
  busy: boolean;
  canUsePlayground: boolean;
  isOrgAdmin: boolean;
  onCreateTool?: () => void;
  onDelete: (toolId: string, toolName: string) => void;
  onConfigureEmail: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const showSearch = tools.length >= toolSearchThreshold;

  const filteredTools = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    if (!needle) {
      return tools;
    }

    return tools.filter((tool) => {
      const haystack =
        `${tool.id} ${tool.name} ${tool.description}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [tools, trimmedQuery]);

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="type-section-title text-balance">{title}</h3>
        {tools.length > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {trimmedQuery
              ? `${filteredTools.length}/${tools.length}`
              : tools.length}
          </span>
        ) : null}
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-border border-dashed px-4 py-6 text-center">
          <p className="text-pretty text-muted-foreground text-xs">
            None registered.
          </p>
          {onCreateTool ? (
            <Button
              disabled={busy}
              onClick={onCreateTool}
              size="sm"
              type="button"
            >
              <PlusIcon
                aria-hidden
                className="size-4"
                data-icon="inline-start"
              />
              Create custom tool
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {showSearch ? (
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label={`Search ${title.toLowerCase()}`}
                className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tools…"
                value={query}
              />
            </div>
          ) : null}

          {filteredTools.length === 0 ? (
            <p className="text-pretty py-6 text-center text-muted-foreground text-sm">
              No tools match &ldquo;{trimmedQuery}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {filteredTools.map((tool) => (
                <ToolListItem
                  busy={busy}
                  key={tool.id}
                  onConfigure={
                    isOrgAdmin && tool.id === BUILTIN_TOOL_IDS.email
                      ? onConfigureEmail
                      : undefined
                  }
                  onDelete={() => onDelete(tool.id, tool.name)}
                  playgroundHref={
                    canUsePlayground && isDeletableTool(tool)
                      ? toolPlaygroundPath(tool.id)
                      : undefined
                  }
                  tool={tool}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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
      <p className="font-medium text-foreground text-sm">{tool.name}</p>
      <p className="mt-0.5 line-clamp-2 text-pretty text-muted-foreground text-xs leading-relaxed">
        {tool.description}
      </p>
    </div>
  );

  return (
    <li className="group flex items-start justify-between gap-3 px-4 py-3 transition-colors duration-150 ease-out first:rounded-t-md last:rounded-b-md hover:bg-muted/40">
      {playgroundHref ? (
        <Link
          aria-label={`Open playground for ${tool.name}`}
          className={cn(
            "min-w-0 flex-1 text-left",
            busy && "pointer-events-none opacity-50"
          )}
          to={playgroundHref}
        >
          {summary}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{summary}</div>
      )}

      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
        {deletable ? (
          <span className="scope-badge scope-badge-custom">custom</span>
        ) : (
          <span className="scope-badge scope-badge-active">built-in</span>
        )}

        {onConfigure ? (
          <Button
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onConfigure();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Configure
          </Button>
        ) : null}

        {deletable ? (
          <Button
            className="text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon
              aria-hidden
              className="size-4"
              data-icon="inline-start"
            />
            Delete
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function PageState({
  message,
  embedded = false,
}: {
  message: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        !embedded && sectionClass,
        "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-muted-foreground text-sm"
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
