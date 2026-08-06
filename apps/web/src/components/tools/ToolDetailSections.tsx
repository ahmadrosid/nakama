import type { ToolDetail } from "@nakama/core/contract";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function ToolDetailSections({
  tool,
  showHeader = false,
}: {
  tool: ToolDetail;
  showHeader?: boolean;
}) {
  return (
    <div className={showHeader ? "space-y-4" : "space-y-5"}>
      {showHeader ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{tool.name}</h2>
            <span className="inline-flex w-fit items-center rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
              {tool.handlerType}
            </span>
          </div>
          {tool.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{tool.description}</p>
          ) : null}
        </div>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="type-code break-all text-foreground">{tool.id}</dd>

          <dt className="text-muted-foreground">Type</dt>
          <dd className="text-foreground">{tool.handlerType}</dd>

          {tool.description ? (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="text-foreground">{tool.description}</dd>
            </>
          ) : null}

          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground">{formatTimestamp(tool.createdAt)}</dd>

          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-foreground">{formatTimestamp(tool.updatedAt)}</dd>
        </dl>
      )}
    </div>
  );
}
