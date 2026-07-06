import type { CachedMcpToolSummary } from "@nakama/core/contract";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { parseMcpToolParameters } from "@/lib/mcp-tool-schema";
import { cn } from "@/lib/utils";

const maxVisibleToolLabels = 12;
const searchThreshold = 4;

interface McpToolLabelsProps {
  serverId: string;
  toolCount: number;
  connected: boolean;
  className?: string;
  onShowAll?: () => void;
}

export function McpToolLabels({
  serverId,
  toolCount,
  connected,
  className,
  onShowAll,
}: McpToolLabelsProps) {
  const { data: server, isLoading } = useMcpServerDetailQuery(toolCount > 0 ? serverId : null);
  const tools = server?.cachedTools ?? [];

  if (toolCount === 0) {
    return null;
  }

  if (isLoading && tools.length === 0) {
    return (
      <div className={cn("mt-2 flex items-center gap-2", className)}>
        <Spinner className="size-3.5" />
        <span className="text-xs text-muted-foreground">Loading tools…</span>
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <p className={cn("mt-2 text-xs text-muted-foreground", className)}>
        {connected
          ? "No tools discovered yet. Try Sync."
          : "Connect and sync to discover tools."}
      </p>
    );
  }

  const visibleTools = tools.slice(0, maxVisibleToolLabels);
  const hiddenCount = tools.length - visibleTools.length;

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <p className="text-xs text-muted-foreground">
        {tools.length} exposed tool{tools.length === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visibleTools.map((tool) => (
          <McpToolLabel key={tool.name} tool={tool} />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="rounded-full border border-dashed border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
            onClick={onShowAll}
          >
            +{hiddenCount} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function McpToolLabel({ tool }: { tool: CachedMcpToolSummary }) {
  return (
    <span
      title={tool.description || tool.name}
      className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
    >
      {tool.name}
    </span>
  );
}

interface McpToolListProps {
  tools: CachedMcpToolSummary[];
  className?: string;
  searchable?: boolean;
}

export function McpToolList({ tools, className, searchable = true }: McpToolListProps) {
  const [query, setQuery] = useState("");
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const filteredTools = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) {
      return tools;
    }

    return tools.filter((tool) => {
      const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [query, tools]);

  if (tools.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        No tools discovered yet.
      </p>
    );
  }

  const showSearch = searchable && tools.length >= searchThreshold;

  return (
    <div className={cn("space-y-3", className)}>
      {showSearch ? (
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools…"
            className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
          />
        </div>
      ) : null}

      {filteredTools.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No tools match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border">
          {filteredTools.map((tool) => (
            <McpToolItem
              key={tool.name}
              tool={tool}
              expanded={expandedName === tool.name}
              onToggle={() =>
                setExpandedName((current) => (current === tool.name ? null : tool.name))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function McpToolItem({
  tool,
  expanded,
  onToggle,
}: {
  tool: CachedMcpToolSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parameters = parseMcpToolParameters(tool.inputSchema);
  const requiredCount = parameters.filter((parameter) => parameter.required).length;
  const hasDetails = Boolean(tool.description) || parameters.length > 0;
  const paramSummary =
    parameters.length > 0
      ? `${parameters.length} param${parameters.length === 1 ? "" : "s"}${
          requiredCount > 0 ? ` · ${requiredCount} required` : ""
        }`
      : null;

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        className={cn(
          "grid h-14 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/30",
          expanded && "bg-muted/20",
          !hasDetails && "cursor-default hover:bg-transparent",
        )}
        aria-expanded={hasDetails ? expanded : undefined}
        disabled={!hasDetails}
        onClick={hasDetails ? onToggle : undefined}
      >
        <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden pt-0.5">
          {hasDetails ? (
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          ) : null}
        </span>

        <span className="min-w-0 pt-px">
          <span className="block truncate font-mono text-sm leading-5 text-foreground">
            {tool.name}
          </span>
          <span
            className={cn(
              "mt-0.5 block h-4 truncate text-xs leading-4 text-muted-foreground",
              !paramSummary && "invisible",
            )}
          >
            {paramSummary ?? "No parameters"}
          </span>
        </span>

        <span
          className={cn(
            "mt-px hidden w-7 shrink-0 justify-self-end rounded-full bg-muted px-2 py-0.5 text-center font-mono text-[11px] leading-4 text-muted-foreground sm:inline",
            !parameters.length && "invisible",
          )}
          aria-hidden
        >
          {parameters.length || 0}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded && hasDetails ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {hasDetails ? (
            <div className="space-y-3 border-t border-border/70 bg-muted/10 px-3 py-3 pl-9">
              {tool.description ? (
                <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {tool.description}
                </p>
              ) : null}

              {parameters.length > 0 ? (
                <McpToolParameters parameters={parameters} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function McpToolParameters({
  parameters,
}: {
  parameters: ReturnType<typeof parseMcpToolParameters>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">Parameters</p>
      <ul className="space-y-1.5">
        {parameters.map((parameter) => (
          <li
            key={parameter.name}
            className="rounded-md border border-border/70 bg-background/80 px-2.5 py-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-xs text-foreground">{parameter.name}</code>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {parameter.type}
              </span>
              {parameter.required ? (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-200">
                  required
                </span>
              ) : null}
            </div>
            {parameter.description ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {parameter.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
