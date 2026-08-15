import type { CachedMcpToolSummary } from "@nakama/core/contract";
import { ArrowRight01Icon, Search01Icon } from "hugeicons-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { parseMcpToolParameters } from "@/lib/mcp-tool-schema";
import { cn } from "@/lib/utils";

const maxVisibleToolLabels = 12;
const searchThreshold = 4;

interface McpToolLabelsProps {
  className?: string;
  connected: boolean;
  onShowAll?: () => void;
  serverId: string;
  toolCount: number;
}

export function McpToolLabels({
  serverId,
  toolCount,
  connected,
  className,
  onShowAll,
}: McpToolLabelsProps) {
  const { data: server, isLoading } = useMcpServerDetailQuery(
    toolCount > 0 ? serverId : null
  );
  const tools = server?.cachedTools ?? [];

  if (toolCount === 0) {
    return null;
  }

  if (isLoading && tools.length === 0) {
    return (
      <div className={cn("mt-2 flex items-center gap-2", className)}>
        <Spinner className="size-3.5" />
        <span className="text-muted-foreground text-xs">Loading tools…</span>
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <p className={cn("mt-2 text-muted-foreground text-xs", className)}>
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
      <p className="text-muted-foreground text-xs">
        {tools.length} exposed tool{tools.length === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visibleTools.map((tool) => (
          <McpToolLabel key={tool.name} tool={tool} />
        ))}
        {hiddenCount > 0 ? (
          <button
            className="rounded-full border border-border border-dashed px-2.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-muted/50"
            onClick={onShowAll}
            type="button"
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
      className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-2xs text-muted-foreground"
      title={tool.description || tool.name}
    >
      {tool.name}
    </span>
  );
}

interface McpToolListProps {
  className?: string;
  searchable?: boolean;
  tools: CachedMcpToolSummary[];
}

export function McpToolList({
  tools,
  className,
  searchable = true,
}: McpToolListProps) {
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
      <p className={cn("text-muted-foreground text-xs", className)}>
        No tools discovered yet.
      </p>
    );
  }

  const showSearch = searchable && tools.length >= searchThreshold;

  return (
    <div className={cn("space-y-3", className)}>
      {showSearch ? (
        <div className="relative">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools…"
            value={query}
          />
        </div>
      ) : null}

      {filteredTools.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          No tools match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border">
          {filteredTools.map((tool) => (
            <McpToolItem
              expanded={expandedName === tool.name}
              key={tool.name}
              onToggle={() =>
                setExpandedName((current) =>
                  current === tool.name ? null : tool.name
                )
              }
              tool={tool}
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
  const requiredCount = parameters.filter(
    (parameter) => parameter.required
  ).length;
  const hasDetails = Boolean(tool.description) || parameters.length > 0;
  const paramSummary =
    parameters.length > 0
      ? `${parameters.length} param${parameters.length === 1 ? "" : "s"}${
          requiredCount > 0 ? ` · ${requiredCount} required` : ""
        }`
      : null;

  return (
    <li className="border-border border-b last:border-b-0">
      <button
        aria-expanded={hasDetails ? expanded : undefined}
        className={cn(
          "grid h-14 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/30",
          expanded && "bg-muted/20",
          !hasDetails && "cursor-default hover:bg-transparent"
        )}
        disabled={!hasDetails}
        onClick={hasDetails ? onToggle : undefined}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden pt-0.5">
          {hasDetails ? (
            <ArrowRight01Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          ) : null}
        </span>

        <span className="min-w-0 pt-px">
          <span className="block truncate font-mono text-foreground text-sm leading-5">
            {tool.name}
          </span>
          <span
            className={cn(
              "mt-0.5 block h-4 truncate text-muted-foreground text-xs leading-4",
              !paramSummary && "invisible"
            )}
          >
            {paramSummary ?? "No parameters"}
          </span>
        </span>

        <span
          aria-hidden
          className={cn(
            "mt-px hidden w-7 shrink-0 justify-self-end rounded-full bg-muted px-2 py-0.5 text-center font-mono text-2xs text-muted-foreground leading-4 sm:inline",
            !parameters.length && "invisible"
          )}
        >
          {parameters.length || 0}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded && hasDetails ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {hasDetails ? (
            <div className="space-y-3 border-border/70 border-t bg-muted/10 px-3 py-3 pl-9">
              {tool.description ? (
                <p className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
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
      <p className="font-medium text-foreground text-xs">Parameters</p>
      <ul className="space-y-1.5">
        {parameters.map((parameter) => (
          <li
            className="rounded-md border border-border/70 bg-background/80 px-2.5 py-2"
            key={parameter.name}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-foreground text-xs">
                {parameter.name}
              </code>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                {parameter.type}
              </span>
              {parameter.required ? (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-2xs text-amber-800 dark:text-amber-200">
                  required
                </span>
              ) : null}
            </div>
            {parameter.description ? (
              <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                {parameter.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
