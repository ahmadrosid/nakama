import { isProtectedToolId } from "@tinyclaw/core/tools/protected";
import { Trash2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToolQuery, useToolSourceQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { NAV_ITEM_ICONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const SHARED_BUILTIN_FILE = "packages/core/src/tools/builtin.ts";

interface ToolDetailDialogProps {
  toolId: string | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (toolId: string, toolName: string) => void;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatHandlerConfig(handlerConfig: unknown): string {
  if (handlerConfig === undefined || handlerConfig === null) {
    return "null";
  }

  try {
    return JSON.stringify(handlerConfig, null, 2);
  } catch {
    return String(handlerConfig);
  }
}

function isEmptyHandlerConfig(handlerConfig: unknown): boolean {
  if (handlerConfig === null || handlerConfig === undefined) {
    return true;
  }

  if (typeof handlerConfig === "object" && !Array.isArray(handlerConfig)) {
    return Object.keys(handlerConfig).length === 0;
  }

  return false;
}

export function ToolDetailDialog({
  toolId,
  busy,
  onOpenChange,
  onDelete,
}: ToolDetailDialogProps) {
  const {
    data: tool,
    isLoading: toolLoading,
    error: toolError,
  } = useToolQuery(toolId);
  const {
    data: source,
    isLoading: sourceLoading,
    error: sourceError,
  } = useToolSourceQuery(toolId);

  const deletable = tool ? !isProtectedToolId(tool.id) : false;
  const loading = toolLoading || (sourceLoading && !sourceError);
  const errorMessage = toolError ? formatError(toolError) : null;
  const sourceErrorMessage = sourceError ? formatError(sourceError) : null;
  const showSharedBuiltinNote =
    source?.path === SHARED_BUILTIN_FILE &&
    tool !== undefined &&
    (tool.name === "write_file" || tool.name === "delete_file");

  return (
    <Dialog open={Boolean(toolId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        {toolLoading && !tool ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading tool…
          </div>
        ) : tool ? (
          <>
            <DialogHeader className="gap-2 pr-8 sm:gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30",
                    deletable
                      ? "text-muted-foreground"
                      : "text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  <NAV_ITEM_ICONS.tools className="size-4" aria-hidden />
                </span>
                {tool.name}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">{tool.description}</DialogDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
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
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
              {errorMessage ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}

              <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="type-code break-all text-foreground">{tool.id}</dd>

                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{formatTimestamp(tool.createdAt)}</dd>

                <dt className="text-muted-foreground">Updated</dt>
                <dd className="text-foreground">{formatTimestamp(tool.updatedAt)}</dd>
              </dl>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Handler config</p>
                {isEmptyHandlerConfig(tool.handlerConfig) ? (
                  <p className="text-sm text-muted-foreground">None</p>
                ) : (
                  <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                    {formatHandlerConfig(tool.handlerConfig)}
                  </pre>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Source</p>
                  {source?.path ? (
                    <p className="type-code text-xs text-muted-foreground">{source.path}</p>
                  ) : null}
                </div>

                {showSharedBuiltinNote ? (
                  <p className="text-xs text-muted-foreground">
                    Multiple built-in tools are defined in this file.
                  </p>
                ) : null}

                {sourceLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading source…
                  </div>
                ) : sourceErrorMessage ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Source unavailable. {sourceErrorMessage}
                  </p>
                ) : source ? (
                  <Textarea
                    className="min-h-48 font-mono text-xs leading-relaxed sm:min-h-64"
                    value={source.content}
                    readOnly
                    aria-label={`Source code for ${tool.name}`}
                  />
                ) : null}
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 border-t-0 bg-transparent p-0 pt-2 sm:flex-row sm:justify-between sm:gap-3">
              {deletable ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={busy || loading}
                  onClick={() => onDelete(tool.id, tool.name)}
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Remove
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}

              <Button
                type="button"
                variant="outline"
                className="w-full sm:ml-auto sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        ) : errorMessage ? (
          <>
            <DialogHeader>
              <DialogTitle>Tool details</DialogTitle>
              <DialogDescription>{errorMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="border-t-0 bg-transparent p-0">
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
