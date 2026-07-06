import type { ToolDetail } from "@nakama/core/contract";
import {
  BUILTIN_TOOL_IDS,
  DELEGATE_CODING_TASK_TOOL_ID,
  isProtectedToolId,
} from "@nakama/core/tools/protected";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { CodingHarnessSettingsDialog } from "@/components/CodingHarnessSettingsDialog";
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
import { Spinner } from "@/components/ui/spinner";
import { useToolsQuery, useProfilesQuery } from "@/hooks/use-app-queries";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useAuth } from "@/context/auth-context";
import { useDeleteToolMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { findSuperBotProfile } from "@/lib/profiles";
import { canUseToolPlayground, toolPlaygroundPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

function isDeletableTool(tool: ToolDetail): boolean {
  return !isProtectedToolId(tool.id);
}

export function ToolsTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { navigateToNewChat } = useAppNavigation();
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canUsePlayground = canUseToolPlayground(
    user?.isPlatformAdmin === true,
    activeOrg?.role,
  );
  const { data: tools = [], isLoading, error } = useToolsQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const superBotProfile = findSuperBotProfile(profiles);
  const deleteToolMutation = useDeleteToolMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);
  const [codingHarnessConfigOpen, setCodingHarnessConfigOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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
    return <PageState message="Loading tools…" embedded={embedded} />;
  }

  const content = (
    <div className="min-w-0 p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="type-section-title">All tools</h2>
          <p className="type-body mt-1 text-xs">
            {tools.length === 0
              ? "No tools registered yet"
              : `${tools.length} registered · ${customTools.length} custom · ${builtinTools.length} built-in`}
          </p>
        </div>

        <Button type="button" size="sm" onClick={goToCreateTool}>
          <PlusIcon className="size-4" aria-hidden />
          Create tool
        </Button>
      </div>

      {tools.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
          <p>No tools yet. Ask Super Bot to create one.</p>
          <Button type="button" size="sm" onClick={goToCreateTool}>
            Create tool
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <ToolListSection
            title="Custom tools"
            description={
              customTools.length === 0
                ? "No custom tools yet. Ask Super Bot to create one."
                : `${customTools.length} registered`
            }
            tools={customTools}
            busy={busy}
            canUsePlayground={canUsePlayground}
            isOrgAdmin={isOrgAdmin}
            onCreateTool={goToCreateTool}
            onDelete={requestDeleteTool}
            onConfigureEmail={() => setEmailConfigOpen(true)}
            onConfigureCodingHarnesses={() => setCodingHarnessConfigOpen(true)}
          />

          <ToolListSection
            title="Built-in tools"
            description={`${builtinTools.length} registered`}
            tools={builtinTools}
            busy={busy}
            canUsePlayground={canUsePlayground}
            isOrgAdmin={isOrgAdmin}
            onDelete={requestDeleteTool}
            onConfigureEmail={() => setEmailConfigOpen(true)}
            onConfigureCodingHarnesses={() => setCodingHarnessConfigOpen(true)}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="space-y-4">
        {errorMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {embedded ? content : <section className={cn(sectionClass, "overflow-hidden")}>{content}</section>}
      </div>

      {isOrgAdmin ? (
        <>
          <EmailSettingsDialog open={emailConfigOpen} onOpenChange={setEmailConfigOpen} />
          <CodingHarnessSettingsDialog
            open={codingHarnessConfigOpen}
            onOpenChange={setCodingHarnessConfigOpen}
          />
        </>
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete tool?</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.name ? `"${deleteTarget.name}"` : "this tool"} from every
              profile it is assigned to.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDeleteTool()}
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
  description,
  tools,
  busy,
  canUsePlayground,
  isOrgAdmin,
  onCreateTool,
  onDelete,
  onConfigureEmail,
  onConfigureCodingHarnesses,
}: {
  title: string;
  description: string;
  tools: ToolDetail[];
  busy: boolean;
  canUsePlayground: boolean;
  isOrgAdmin: boolean;
  onCreateTool?: () => void;
  onDelete: (toolId: string, toolName: string) => void;
  onConfigureEmail: () => void;
  onConfigureCodingHarnesses: () => void;
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">None registered.</p>
          {onCreateTool ? (
            <Button type="button" size="sm" disabled={busy} onClick={onCreateTool}>
              <PlusIcon className="size-4" aria-hidden />
              Create custom tool
            </Button>
          ) : null}
        </div>
      ) : (
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
              onDelete={() => onDelete(tool.id, tool.name)}
              onConfigure={
                isOrgAdmin && tool.id === BUILTIN_TOOL_IDS.email
                  ? onConfigureEmail
                  : isOrgAdmin && tool.id === DELEGATE_CODING_TASK_TOOL_ID
                    ? onConfigureCodingHarnesses
                  : undefined
              }
            />
          ))}
        </ul>
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
          <span className="scope-badge scope-badge-custom">custom tool</span>
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

function PageState({ message, embedded = false }: { message: string; embedded?: boolean }) {
  return (
    <div
      className={cn(
        !embedded && sectionClass,
        "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
