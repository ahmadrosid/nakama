import type { ToolSummary } from "@tinyclaw/core/contract";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { client, formatError } from "@/lib/client";
import type { PageId } from "@/lib/navigation";

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

interface ToolsPageProps {
  onNavigate: (page: PageId) => void;
}

export function ToolsPage({ onNavigate }: ToolsPageProps) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await client.listTools();
      setTools(response.tools);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

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

    setBusy(true);
    setError(null);

    try {
      await client.deleteTool(tool.id);
      await loadTools();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <section className={cn(sectionClass, "p-5")}>
        <h2 className="text-sm font-semibold text-foreground">Create via agent</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          New tools are registered by <strong className="text-foreground">Super Bot</strong> in
          Chat using the <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">create_tool</code>{" "}
          meta-tool.
        </p>

        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li>Built-in: write_file, delete_file, web_search (provider-native)</li>
          <li>JavaScript tools: modules in ~/.tinyclaw/tools/</li>
          <li>Super Bot only: bash (one-off tasks, not tool files)</li>
          <li>Detach a tool from a bot on Profiles</li>
          <li>Delete JavaScript tools here</li>
        </ul>

        <Button
          type="button"
          className="mt-5 w-full"
          onClick={() => onNavigate("chat")}
        >
          <MessageSquareIcon />
          Open Chat
        </Button>

        <p className="mt-3 text-xs text-muted-foreground">
          Select the <span className="text-foreground">Super Bot</span> profile in Chat, then
          describe the tool you want to add.
        </p>
      </section>

      <section className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className={cn(sectionClass, "p-5")}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">All tools</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {loading ? "Loading…" : `${tools.length} registered`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || busy}
              onClick={() => void loadTools()}
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
                      <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
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
                  <p className="mt-3 font-mono text-[11px] text-muted-foreground/80">{tool.id}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
