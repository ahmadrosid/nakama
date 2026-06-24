import type { ToolDetail } from "@tinyclaw/core/contract";
import { ToolSourceCodeBlock } from "@/components/tools/ToolSourceCodeBlock";
import { Spinner } from "@/components/ui/spinner";
import { useToolSourceQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

const SHARED_BUILTIN_FILE = "packages/core/src/tools/builtin.ts";

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

export function ToolDetailSections({
  tool,
  showHeader = false,
}: {
  tool: ToolDetail;
  showHeader?: boolean;
}) {
  const {
    data: source,
    isLoading: sourceLoading,
    error: sourceError,
  } = useToolSourceQuery(tool.id);

  const sourceErrorMessage = sourceError ? formatError(sourceError) : null;
  const showSharedBuiltinNote =
    source?.path === SHARED_BUILTIN_FILE &&
    (tool.name === "write_file" || tool.name === "delete_file" || tool.name === "read_file");

  return (
    <div className={showHeader ? "space-y-4" : "space-y-5"}>
      {showHeader ? (
        <div className="space-y-2 border-b border-border pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="text-sm font-semibold text-foreground">{tool.name}</h2>
              <span className="inline-flex w-fit items-center rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                {tool.handlerType}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
          </div>

          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div className="flex min-w-0 max-w-full items-baseline gap-1.5 sm:max-w-[55%]">
              <dt className="shrink-0 text-muted-foreground">ID</dt>
              <dd className="type-code truncate text-foreground" title={tool.id}>
                {tool.id}
              </dd>
            </div>
            <div className="flex shrink-0 items-baseline gap-1.5">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="text-foreground">{formatTimestamp(tool.createdAt)}</dd>
            </div>
            <div className="flex shrink-0 items-baseline gap-1.5">
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="text-foreground">{formatTimestamp(tool.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="type-code break-all text-foreground">{tool.id}</dd>

          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground">{formatTimestamp(tool.createdAt)}</dd>

          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-foreground">{formatTimestamp(tool.updatedAt)}</dd>
        </dl>
      )}

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
          <ToolSourceCodeBlock content={source.content} path={source.path} />
        ) : null}
      </div>
    </div>
  );
}
